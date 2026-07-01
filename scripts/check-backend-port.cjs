/**
 * Client predev — warn once if backend port 4000 is not listening.
 */
const net = require('net');

const port = parseInt(process.env.PORT || '4000', 10);

const socket = net.connect({ port, host: '127.0.0.1' });
socket.setTimeout(800);

socket.on('connect', () => {
  socket.destroy();
  process.exit(0);
});

socket.on('timeout', fail);
socket.on('error', fail);

function fail() {
  socket.destroy();
  console.warn('\n  ⚠  Backend is not running on port ' + port);
  console.warn('     Start the full stack from project root:\n');
  console.warn('       npm run dev:all\n');
  console.warn('     Or in a separate terminal:\n');
  console.warn('       npm run dev\n');
  process.exit(0);
}
