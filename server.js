require('dotenv').config();

const express = require('express');
const cors = require('cors');

const equipmentRoutes = require('./routes/equipment');
const exercisesRoutes = require('./routes/exercises');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const routinesRoutes = require('./routes/routines');
const { ApiError, mapPgError } = require('./utils/http');

const app = express();

app.use(express.json());
app.use(cors());

app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

app.use('/api/equipment', equipmentRoutes);
app.use('/api/exercises', exercisesRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/routines', routinesRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  const mapped = mapPgError(err);

  if (mapped instanceof ApiError) {
    const body = { success: false, message: mapped.message };
    if (mapped.errors) body.errors = mapped.errors;
    return res.status(mapped.statusCode).json(body);
  }

  console.error(mapped);
  return res.status(500).json({
    success: false,
    message: 'Error interno del servidor.',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
