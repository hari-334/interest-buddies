const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: '60446',
    resave: false,
    saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));

// Set up MongoDB
mongoose.connect('mongodb://localhost/auth_example', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log('Connected to MongoDB');
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
    });

// Define User schema
const UserSchema = new mongoose.Schema({
    name: String,
    username: String,
    password: String
});

const User = mongoose.model('User', UserSchema);

// Define Group schema
const GroupSchema = new mongoose.Schema({
    name: String,
    purpose: String,
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    created_at: { type: Date, default: Date.now },
    chatHistory: [{ sender: String, message: String, timestamp: { type: Date, default: Date.now } }]
});

const Group = mongoose.model('Group', GroupSchema);

// Routes
app.get('/', (req, res) => {
    if (req.session.user) {
        res.render('home', { user: req.session.user });
        console.log(req.session)
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login.ejs');
});

app.post('/login', async (req, res) => {
    try {
        const { name, username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            throw new Error('Invalid username or password');
        }
        req.session.user = user;
        res.redirect('/');
    } catch (error) {
        res.render('login', { error: 'Invalid username or password' });
    }
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    try {
        const { name, username, password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            throw new Error('Username already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name,
            username,
            password: hashedPassword
        });

        await newUser.save();
        res.redirect('/login');
    } catch (error) {
        res.render('register', { error: error.message });
    }
});

app.get('/create-group', (req, res) => {
    res.render('create-group');
});

app.post('/create-group', async (req, res) => {
    try {
        const { name, purpose } = req.body;

        const newGroup = new Group({
            name,
            purpose,
            members: [req.session.user._id]
        });

        await newGroup.save();
        res.redirect('/dashboard');
    } catch (error) {
        res.render('create-group', { error: 'Error creating group' });
    }
});

app.get('/dashboard', async (req, res) => {
    try {
        const user = req.session.user;
        const groups = await Group.find().populate('members').exec();

        res.render('dashboard', { user, groups });
    } catch (error) {
        res.render('dashboard', { user: req.session.user, groups: [], error: 'Error fetching groups' });
    }
});

app.post('/join-group', async (req, res) => {
    try {
        const group = await Group.findById(req.body.group_id);

        if (!group) {
            throw new Error('Group not found');
        }

        if (!group.members.includes(req.session.user._id)) {
            group.members.push(req.session.user._id);
            await group.save();
        }

        res.redirect('/dashboard');
    } catch (error) {
        res.render('dashboard', { user: req.session.user, error: 'Error joining group' });
    }
});

app.get('/group/:id', async (req, res) => {
    try {
        const group = await Group.findById(req.params.id).populate('members').exec();

        if (!group) {
            return res.redirect('/dashboard');
        }

        res.render('group', { group });
    } catch (error) {
        res.render('dashboard', { user: req.session.user, error: 'Error fetching group' });
    }
});

app.post('/search-groups', async (req, res) => {
    const { searchQuery } = req.body;

    const groups = await Group.find({
        $or: [
            { name: { $regex: searchQuery, $options: 'i' } },
            { purpose: { $regex: searchQuery, $options: 'i' } }
        ]
    }).populate('members').exec();

    res.render('dashboard', { user: req.session.user, groups });
});

app.get('/logout', (req, res) => {
    res.redirect('/login');
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-group', (groupId) => {
        socket.join(groupId);
        console.log(`User ${socket.id} joined group ${groupId}`);
    });

    socket.on('send-message', async (data) => {
        try {
            const { groupId, message } = data;
            const group = await Group.findById(groupId);

            if (!group) {
                throw new Error('Group not found');
            }

            group.chatHistory.push({ sender: socket.id, message });
            await group.save();
            //const senderUser = await User.findById(socket.id);
            io.to(groupId).emit('receive-message', { message, sender: socket.id });
        } catch (error) {
            console.error('Error sending message:', error);
        }
    });
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('Server is running on port 3000');
});
