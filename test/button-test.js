const { buttonInput } = require("../device/button");

buttonInput.watch((err, value) => {
  if (err) {
    console.error("Error while watching the switch:", err);
    return;
  }

  if (value === 0) {
    console.log("Switch released");
  } else {
    console.log("Switch pressed");
  }
});
