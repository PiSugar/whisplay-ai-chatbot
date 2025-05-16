const { connect } = require('net');
const { EventEmitter } = require('events');

class PiSugarBattery extends EventEmitter {

  client = null;
  batteryLevel = 0;
  isConnected = false;
  interval = null;

  constructor() {
    super();
    this.client = null;
    this.batteryLevel = 0;
    this.isConnected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.client = connect(8423, '0.0.0.0', () => {
        console.log('Connected to battery service');
        this.isConnected = true;
        this.interval = setInterval(() => {
          if (this.isConnected) {
            this.client.write('get battery\n');
          }
        }, 5000);
        resolve();
      });
      this.client.on('data', (data) => {
        const message = data.toString();
        if (message.startsWith('battery:')) {
          const level = parseInt(message.split(':')[1], 10);
          this.batteryLevel = level;
          this.emit('batteryLevel', level);
        }
      });
      this.client.on('error', (err) => {
        console.error('Battery service error:', err);
        this.isConnected = false;
        clearInterval(this.interval);
        reject(err);
      });
      this.client.on('end', () => {
        console.log('Disconnected from battery service');
        this.isConnected = false;
        clearInterval(this.interval);
      });
    }
    );
  }
  disconnect() {
    if (this.client) {
      this.client.end();
      this.isConnected = false;
    }
  }
  getBatteryLevel() {
    return this.batteryLevel;
  }
  isConnected() {
    return this.isConnected;
  }
}

module.exports = PiSugarBattery;
