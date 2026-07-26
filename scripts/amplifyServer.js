process.env.NODE_ENV = 'production';

const { createApp } = require('./server/index');

const configuredPort = Number(process.env.PORT);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;

createApp().listen(port, '0.0.0.0', () => {
  console.log(`Northstar Markets is listening on port ${port}`);
});
