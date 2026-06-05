const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors'); // Importante para permitir conexão externa

const app = express();
app.use(cors()); // Ativa o CORS para todas as rotas

const server = http.createServer(app);

// Configuração do Socket.io permitindo qualquer origem (CORS)
const io = new Server(server, {
  cors: {
    origin: "*", // Em produção, mude para a URL específica do seu frontend
    methods: ["GET", "POST"]
  }
});

// ==========================================
// CONFIGURAÇÃO DO JSONBIN
// ==========================================
const JSONBIN_BIN_ID = '6a22d47fda38895dfe8c8630'; 
const JSONBIN_API_KEY = '$2a$10$RihuJ5By738H.EgSa7vcA.TtNtn6UX5MPRNXX3dnwkL2396QsGciq';

let localDbFallback = null;

async function fetchExternalUsers() {
  if (localDbFallback) return localDbFallback;
  try {
    const fetch = await import('node-fetch');
    const res = await fetch.default(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    const data = await res.json();
    localDbFallback = data.record;
    return localDbFallback;
  } catch (err) {
    console.error("Erro ao acessar JSONBin, usando dados locais de fallback:", err.message);
    localDbFallback = {
      "users": {
        "Rita": { "password": "123456789", "avatar": "https://api.dicebear.com/7.x/identicon/svg?seed=Rita" },
        "Eduardo": { "password": "987654321", "avatar": "https://api.dicebear.com/7.x/identicon/svg?seed=Eduardo" },
        "Mateus": { "password": "tkkmh123", "avatar": "https://api.dicebear.com/7.x/identicon/svg?seed=Mateus" }
      }
    };
    return localDbFallback;
  }
}

// ==========================================
// CONTROLE DE CONEXÕES EM MEMÓRIA
// ==========================================
const onlineUsers = {};

io.on('connection', (socket) => {
  
  socket.on('login', async (data) => {
    const { username, password } = data;
    const db = await fetchExternalUsers();
    const user = db.users && db.users[username];

    if (user && user.password === password) {
      onlineUsers[socket.id] = {
        id: socket.id,
        username: username,
        avatar: user.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${username}`
      };

      socket.emit('login-success', onlineUsers[socket.id]);
      io.emit('update-users', Object.values(onlineUsers));
    } else {
      socket.emit('login-error', 'Usuário ou senha incorretos.');
    }
  });

  socket.on('voice-ready', () => {
    socket.broadcast.emit('peer-joined', { id: socket.id });
  });

  socket.on('webrtc-signal', (data) => {
    io.to(data.to).emit('webrtc-signal', {
      from: socket.id,
      signal: data.signal
    });
  });

  socket.on('update-password', async (data) => {
    if (onlineUsers[socket.id]) {
      const username = onlineUsers[socket.id].username;
      
      if (localDbFallback && localDbFallback.users && localDbFallback.users[username]) {
        localDbFallback.users[username].password = data.password;
      }

      if (data.avatar) {
        onlineUsers[socket.id].avatar = data.avatar;
        if (localDbFallback && localDbFallback.users && localDbFallback.users[username]) {
          localDbFallback.users[username].avatar = data.avatar;
        }
      }
      
      socket.emit('password-updated-success', { password: data.password });
      io.emit('update-users', Object.values(onlineUsers));
    }
  });

  socket.on('disconnect', () => {
    if (onlineUsers[socket.id]) {
      delete onlineUsers[socket.id];
      io.emit('update-users', Object.values(onlineUsers));
      io.emit('peer-left', { id: socket.id });
    }
  });
});

// Uma rota simples de API para checar se o servidor está online
app.get('/api/status', (req, res) => {
  res.json({ status: "online", usersOnline: Object.keys(onlineUsers).length });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 API & WebSocket rodando em http://localhost:${PORT}`);
});