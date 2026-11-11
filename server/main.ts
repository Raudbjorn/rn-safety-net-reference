import { createGateway } from './gateway';

const DEFAULT_PORT = 3000;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const faultsEnabled = process.env.FAULTS === '1';

// Bound to all interfaces so an Android emulator can reach it as 10.0.2.2. Demo only.
const { app } = createGateway({ faultsEnabled });
const server = app.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ msg: 'gateway listening', port, faultsEnabled }));
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
