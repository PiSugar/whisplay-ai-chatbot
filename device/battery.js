// 连接电池tcp服务
// 间隔5秒发送一次get battery
// 当收到数据battery: 80时，将电池电量更新

import { connect } from 'net';
import { EventEmitter } from 'events';

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
