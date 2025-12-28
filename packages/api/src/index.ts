import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'threadsponder-api' });
});

// TODO: Add routes
// app.use('/api/auth', authRoutes);
// app.use('/api/threads', threadsRoutes);
// app.use('/api/voice', voiceRoutes);
// app.use('/api/posts', postsRoutes);
// app.use('/api/friends', friendsRoutes);
// app.use('/api/analytics', analyticsRoutes);
// app.use('/api/billing', billingRoutes);

app.listen(PORT, () => {
  console.log(`[API] Server running on port ${PORT}`);
});

export default app;
