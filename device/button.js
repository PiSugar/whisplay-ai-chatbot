const { Gpio } = require("onoff");
const { convertPin } = require("./pin-convert");

// cat /sys/kernel/debug/gpio

// Define the physical pin number connected to the switch
const BUTTON_PIN = convertPin(17); // GPIO17

// Set GPIO pin to input mode and enable pull-up resistor
const buttonInput = new Gpio(BUTTON_PIN, "in", "both", { debounceTimeout: 10 });

console.log(`Listening for the switch connected to GPIO ${BUTTON_PIN}...`);

module.exports = {
  buttonInput,
};
