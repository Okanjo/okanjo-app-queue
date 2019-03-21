
// For unit testing, pull env config from env vars
const host = process.env.RABBIT_HOST || 'localhost';
const port = process.env.RABBIT_PORT || 5672;
const login = process.env.RABBIT_USER || 'test';
const password = process.env.RABBIT_PASS || 'test';
const vhost = process.env.RABBIT_VHOST || 'test';

module.exports = {
    rabbit: {
        host,
        port,

        login,
        password,

        vhost,

        // Handle connection drop scenarios
        reconnect: true,
        reconnectBackoffStrategy: 'linear',
        reconnectBackoffTime: 1000,
        reconnectExponentialLimit: 5000 // don't increase over 5s to reconnect
    }
};