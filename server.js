const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// --- MONGODB KAPCSOLAT ---
const MONGO_URI = process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Adatbázis csatlakoztatva!'))
    .catch(err => console.error('❌ MongoDB hiba:', err));

// --- JÁTÉKOS MODELL (Mentett adatok) ---
const playerSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    highScore: { type: Number, default: 0 },
    currentSkinId: { type: String, default: 'starter' }
});
const Player = mongoose.model('Player', playerSchema);

// --- JÁTÉK ÁLLAPOT ---
const MAP_SIZE = 5000;
let players = {};
let food = [];

function spawnFood(count = 10) {
    const colors = ['#ff0055', '#00ff55', '#0055ff', '#ffff00', '#ff00ff', '#00ffff'];
    for(let i=0; i<count; i++) {
        food.push({
            id: Math.random(),
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            c: colors[Math.floor(Math.random() * colors.length)]
        });
    }
}
spawnFood(600);

// --- HÁLÓZATI LOGIKA ---
io.on('connection', (socket) => {
    socket.on('auth', async (data) => {
        try {
            let user = await Player.findOne({ username: data.username });
            if (!user) {
                user = await Player.create({ 
                    username: data.username, 
                    password: data.password,
                    currentSkinId: 'starter'
                });
            } else if (user.password !== data.password) {
                return socket.emit('auth_error', 'Helytelen jelszó!');
            }

            players[socket.id] = {
                id: socket.id,
                dbId: user._id,
                username: user.username,
                xp: user.xp,
                level: user.level,
                skinId: user.currentSkinId,
                blobs: [{ x: Math.random()*MAP_SIZE, y: Math.random()*MAP_SIZE, r: 30 }],
                score: 0
            };

            socket.emit('auth_success', {
                username: user.username,
                xp: user.xp,
                level: user.level,
                skinId: user.currentSkinId
            });
        } catch (e) {
            socket.emit('auth_error', 'Szerver hiba történt.');
        }
    });

    socket.on('update_input', (data) => {
        const p = players[socket.id];
        if (!p) return;

        p.blobs.forEach(blob => {
            const dx = data.mx - (data.vw / 2);
            const dy = data.my - (data.vh / 2);
            const dist = Math.sqrt(dx*dx + dy*dy);
            const speed = Math.max(1.2, 9 - (blob.r / 50));

            if (dist > 15) {
                blob.x += (dx/dist) * speed;
                blob.y += (dy/dist) * speed;
            }
            blob.x = Math.max(0, Math.min(MAP_SIZE, blob.x));
            blob.y = Math.max(0, Math.min(MAP_SIZE, blob.y));

            // Evés
            food = food.filter(f => {
                const d = Math.sqrt((f.x-blob.x)**2 + (f.y-blob.y)**2);
                if (d < blob.r) {
                    blob.r += 0.3;
                    p.xp += 3;
                    p.score += 1;
                    return false;
                }
                return true;
            });
        });
        if(food.length < 600) spawnFood(5);
    });

    socket.on('change_skin', async (skinId) => {
        if (players[socket.id]) {
            players[socket.id].skinId = skinId;
            await Player.findByIdAndUpdate(players[socket.id].dbId, { currentSkinId: skinId });
        }
    });

    socket.on('disconnect', async () => {
        if (players[socket.id]) {
            const p = players[socket.id];
            const finalLvl = Math.floor(Math.sqrt(p.xp / 200)) + 1;
            await Player.findByIdAndUpdate(p.dbId, {
                xp: p.xp,
                level: finalLvl,
                highScore: Math.max(p.score, 0)
            });
            delete players[socket.id];
        }
    });
});

setInterval(() => {
    io.emit('game_state', { players, food });
}, 33);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Nebulous 3D szerver fut: ${PORT}`));

