const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Statikus fájlok kiszolgálása a 'public' mappából
app.use(express.static(path.join(__dirname, 'public')));

// --- MONGODB CSATLAKOZÁS ---
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nebulous_db';
mongoose.connect(MONGO_URI)
    .then(() => console.log('Sikeres MongoDB kapcsolat!'))
    .catch(err => console.error('MongoDB hiba:', err));

// Játékos séma definiálása
const playerSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    skinId: { type: String, default: 'starter' },
    highScore: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// --- JÁTÉK MOTOR ADATOK ---
const MAP_SIZE = 4000;
let players = {}; 
let food = [];

// Étel generálása
function spawnFood(count = 1) {
    const colors = ['#ff4d4d', '#4dff4d', '#4d4dff', '#ffff4d', '#ff4dff', '#4dffff'];
    for(let i = 0; i < count; i++) {
        food.push({
            id: Math.random(),
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            c: colors[Math.floor(Math.random() * colors.length)]
        });
    }
}
spawnFood(500);

// --- HÁLÓZATI ESEMÉNYEK ---
io.on('connection', (socket) => {
    // Belépés és Adatbázis szinkronizáció
    socket.on('auth', async (data) => {
        try {
            let user = await Player.findOne({ username: data.username });
            if (!user) {
                // Új profil létrehozása
                user = await Player.create({ 
                    username: data.username, 
                    password: data.password,
                    skinId: data.skinId || 'starter'
                });
            } else if (user.password !== data.password) {
                return socket.emit('auth_error', 'Hibás jelszó!');
            }

            // Játékos adatok betöltése a memóriába
            players[socket.id] = {
                id: socket.id,
                dbId: user._id,
                username: user.username,
                xp: user.xp,
                level: user.level,
                skinId: data.skinId || user.skinId,
                blobs: [{ x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE, r: 25 }],
                score: 0
            };

            socket.emit('auth_success', {
                username: user.username,
                xp: user.xp,
                level: user.level,
                skinId: players[socket.id].skinId
            });
        } catch (err) {
            socket.emit('auth_error', 'Szerver hiba történt.');
        }
    });

    // Mozgás és ütközés kezelése
    socket.on('update_input', (data) => {
        const p = players[socket.id];
        if (!p) return;

        p.blobs.forEach(blob => {
            const dx = data.mx - (data.vw / 2);
            const dy = data.my - (data.vh / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);
            const speed = Math.max(1, 8 - (blob.r / 60));

            if (dist > 10) {
                blob.x += (dx / dist) * speed;
                blob.y += (dy / dist) * speed;
            }

            blob.x = Math.max(0, Math.min(MAP_SIZE, blob.x));
            blob.y = Math.max(0, Math.min(MAP_SIZE, blob.y));

            // Étel evés logika
            food = food.filter(f => {
                const d = Math.sqrt((f.x - blob.x) ** 2 + (f.y - blob.y) ** 2);
                if (d < blob.r) {
                    blob.r += 0.25;
                    p.xp += 2;
                    p.score += 1;
                    return false;
                }
                return true;
            });
        });
        if (food.length < 500) spawnFood(5);
    });

    // Kilépés és XP mentés
    socket.on('disconnect', async () => {
        if (players[socket.id]) {
            const p = players[socket.id];
            const newLevel = Math.floor(Math.sqrt(p.xp / 200)) + 1;
            try {
                await Player.findByIdAndUpdate(p.dbId, {
                    xp: p.xp,
                    level: newLevel,
                    skinId: p.skinId
                });
            } catch (err) {
                console.error('Mentési hiba:', err);
            }
            delete players[socket.id];
        }
    });
});

// Frissítés küldése 30 FPS-sel
setInterval(() => {
    io.emit('game_state', { players, food });
}, 33);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Szerver fut a ${PORT} porton`));

