/***************************************************
  This set of common test scripts can be used for
  RGB565 TFT displays.

  These displays use SPI to communicate, 4 or 5 pins are required to
  interface
  Adafruit invests time and resources providing this open source code,
  please support Adafruit and open-source hardware by purchasing
  products from Adafruit!

  Written by Limor Fried/Ladyada for Adafruit Industries.
  BSD license, all text above must be included in any redistribution

  Code ported to NodeJS by Lyndel R. McGee
  Original source of this code was:
  https://github.com/adafruit/Adafruit-SSD1351-library

  The Adafruit GFX Graphics core library is also required
  https://github.com/adafruit/Adafruit-GFX-Library
  Be sure to install it!
 ****************************************************/
  'use strict';
  const Adafruit_GFX_Library = require("@lynniemagoo/adafruit-gfx-library");
  const delay = Adafruit_GFX_Library.Utils.sleepMs;
  const os = require("os");
  
  const toInt = Math.trunc,
        fMax = Math.max,
        fMin = Math.min,
        fFloor = Math.floor,
        fRandom = Math.random;
  
  // Random Number Helper method
  // See https://stackoverflow.com/questions/4959975/generate-random-number-between-two-numbers-in-javascript
  function randomInteger(min, max) {
      return fFloor(fRandom() * (max - min + 1)) + min;
  }
  
  // Color definitions
  const BLACK   = 0x0000;
  const BLUE    = 0x001F;
  const RED     = 0xF800;
  const GREEN   = 0x07E0;
  const CYAN    = 0x07FF;
  const MAGENTA = 0xF81F;
  const YELLOW  = 0xFFE0;
  const WHITE   = 0xFFFF;
  
  /**************************************************************************/
  /*!
      @brief  Renders a simple test pattern on the screen
  */
  /**************************************************************************/
  async function lcdTestPattern(canvas, display) {
      const w = canvas.width(), h = canvas.height(),
            localColors = [RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA, BLACK, WHITE];
  
      for(let c=0; c<8; c++) {
          await canvas.fillRect(0, h * c / 8, w, h / 8, localColors[c]);
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  }
  
  async function testLines(canvas, display, color) {
      const w = canvas.width(), h = canvas.height();
      let x, y;
  
      await canvas.fillScreen(BLACK);
      for(x=0; x < w-1; x+=6) {
          // the JS version of this canvas is chainable so we can chain methods
          // that modify the buffer or canvas.
          await canvas.drawLine(0, 0, x, h-1, color);
      }
      for (y=0; y < h-1; y+=6) {
          // the JS version of this canvas is chainable so we can chain methods
          // that modify the buffer or canvas.
          await canvas.drawLine(0, 0, w-1, y, color);
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
      
      await canvas.fillScreen(BLACK);
      for (x=0; x < w-1; x+=6) {
          await canvas.drawLine(w-1, 0, x, h-1, color);
      }
      for (y=0; y < h-1; y+=6) {
          await canvas.drawLine(w-1, 0, 0, y, color);
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  
      await canvas.fillScreen(BLACK);
      for (x=0; x < w-1; x+=6) {
          await canvas.drawLine(0, h-1, x, 0, color);
      }
      for (y=0; y < h-1; y+=6) {
          await canvas.drawLine(0, h-1, w-1, y, color);
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  
      await canvas.fillScreen(BLACK);
      for (x=0; x < w-1; x+=6) {
          await canvas.drawLine(w-1, h-1, x, 0, color);
      }
      for (y=0; y < h-1; y+=6) {
          await canvas.drawLine(w-1, h-1, 0, y, color);
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  }
  
  async function testDrawText(canvas, display, text, color) {
  
      const previousWrap = canvas.getTextWrap();
      await canvas.setCursor(0,0)
                  .setTextWrap(true)
                  .setTextColor(color)
                  .print(text)
                  .setTextWrap(previousWrap);
                  
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  }
  
  async function testFastLines(canvas, display, color1, color2) {
      const w = canvas.width(), h = canvas.height();
  
      await canvas.fillScreen(BLACK);
  
      for (let y=0; y < h-1; y+=5) {
          await canvas.drawFastHLine(0, y, w-1, color1);
      }
      for (let x=0; x < w-1; x+=5) {
          await canvas.drawFastVLine(x, 0, h-1, color2);
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  }
  
  async function tftPrintTest(canvas, display, colors = [WHITE], loop_delay = 1) {
  
      await canvas.fillScreen(BLACK);
  
      await canvas.setCursor(0, 5)
                  .setTextColor(RED)
                  .setTextSize(1)
                  .println("Hello World!");
  
      await delay(1500);
      await canvas.setTextColor(YELLOW)
                  .setTextSize(2)
                  .println("Hello World!");
  
      await delay(1500);
  
      await canvas.setTextColor(BLUE)
                  .setTextSize(3)
                  .print(1234.567);
  
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  
      await canvas.fillScreen(BLACK);
  
      await canvas.setCursor(0, 5)
                  .setTextColor(WHITE)
                  .setTextSize(0)
                  .println("Hello World!");
  
      await canvas.setTextSize(1)
                  .setTextColor(GREEN)
                  .print(Math.PI.toFixed(6))
                  .println(" Want pi?")
                  .println(" ");
  
      //await canvas.print(8675309, HEX); // print 8,675,309 out in HEX!
      const value = 8675309;
      await canvas.print("0x" + value.toString(16).toUpperCase().padStart(8, "0")) // print 8,675,309 out in HEX!
                  .println(" Print HEX!")
                  .println(" ")
                  .setTextColor(WHITE)
                  .println("System has been")
                  .println("running for: ")
                  .setTextColor(MAGENTA)
                  .print(os.uptime())
                  .setTextColor(WHITE)
                  .print(" seconds.");
  
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  }
  
  
  async function testDrawRects(canvas, display, color) {
      const w = canvas.width(), h = canvas.height();
      await canvas.fillScreen(BLACK);
  
      for(let x=0; x < h -1; x+=6) {
          await canvas.drawRect((w-1)/2 - x/2, (h-1)/2 - x/2, x, x, color);
          await display.fastRenderGFXcanvas16(canvas);
          await delay(10);
      }
      await delay(1500);
  }
  
  
  async function testFillRects(canvas, display, color1, color2) {
      const w = canvas.width(), h = canvas.height();
      await canvas.fillScreen(BLACK);
  
      for(let x=h-1; x>6; x-=6) {
          await canvas.fillRect(toInt((w-1)/2 - x/2), toInt((h-1)/2 - x/2), x, x, color1)
                      .drawRect(toInt((w-1)/2 - x/2), toInt((h-1)/2 - x/2), x, x, color2);
          await display.fastRenderGFXcanvas16(canvas);
          await delay(10);
      }
      await delay(1500);
  }
  
  
  async function testFillCircles(canvas, display, radius, color) {
      const w = canvas.width(), h = canvas.height();
  
      for(let x=radius; x<w-1; x+=radius*2) {
          for(let y=radius; y < h-1; y+=radius*2) {
              await canvas.fillCircle(x, y, radius, color)
          }
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  }
  
  
  async function testDrawCircles(canvas, display, radius, color) {
      const w = canvas.width(), h = canvas.height();
  
      for(let x=0; x<w-1+radius; x+=radius*2) {
          for(let y=0; y<h-1+radius; y+=radius*2) {
              await canvas.drawCircle(x, y, radius, color)
          }
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  }
  
  
  async function testRoundRects(canvas, display) {
      let w = canvas.width(), h = canvas.height();
      let x=0, y=0, color = 100;
  
      await canvas.fillScreen(BLACK);
  
      for(let i = 0 ; i <= 24; i++) {
          await canvas.drawRoundRect(x, y, w, h, 5, color);
          x+=2;
          y+=3;
          w-=4;
          h-=6;
          color+=1100;
          //console.log(i);
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  }
  
  async function testTriangles(canvas, display) {
      const ow = canvas.width(), oh = canvas.height();
      let color = RED,
          w = ow/2,
          x = oh,
          y = 0,
          z = ow;
  
      await canvas.fillScreen(BLACK);
  
      for(let t = 0 ; t <= 15; t+=1) {
          await canvas.drawTriangle(w, y, y, x, z, x, color);
          x-=4;
          y+=4;
          z-=4;
          color+=100;
      }
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  }
  
  
  async function testMediaButtons(canvas, display) {
  
      await canvas.fillScreen(BLACK);
  
      // play
      await canvas.fillRoundRect(25, 10, 78, 60, 8, WHITE);
      await canvas.fillTriangle(42, 20, 42, 60, 90, 40, RED);
  
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  
      // pause
      await canvas.fillRoundRect(25, 90, 78, 60, 8, WHITE);
      await canvas.fillRoundRect(39, 98, 20, 45, 5, GREEN);
      await canvas.fillRoundRect(69, 98, 20, 45, 5, GREEN);
  
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  
      // play color
      await canvas.fillTriangle(42, 20, 42, 60, 90, 40, BLUE);
  
      await display.fastRenderGFXcanvas16(canvas);
      await delay(50);
  
      // pause color
      await canvas.fillRoundRect(39, 98, 20, 45, 5, RED);
      await canvas.fillRoundRect(69, 98, 20, 45, 5, RED);
  
      // play color
      await canvas.fillTriangle(42, 20, 42, 60, 90, 40, GREEN);
      
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  }
  
  
  async function testCP437CharacterSet(canvas, display, color) {
  
      const previousWrap = canvas.getTextWrap();
      const previousCP437 = canvas.getCP437();
  
      await canvas.fillScreen(BLACK);
  
      await canvas.setTextSize(1)                // Normal 1:1 pixel scale
                  .setTextWrap(false)
                  .setTextColor(color)   // Draw colored text
                  .setCursor(0, 0)               // Start at top-left corner
                  .setCP437(true);                  // Use full 256 char 'Code Page 437' font
  
      // Not all the characters will fit on the canvas. This is normal.
      // Library will draw what it can and the rest will be clipped.
      for(let i=0; i<256; i++) {
          // canvas.write will simply chain work onto the queue if needed.
          // Don't have to await each step as this is done below with final
          // canvas.wait.
          if (i === 0x0A) continue;
          canvas.write(i);
          if ((i > 0) && (i % 21 == 0)) canvas.println();
      }
      // await require here to ensure that all write operations in loop have finished
      // as we did not await within the loop.
      await canvas.setCP437(previousCP437)
                  .setTextWrap(previousWrap);
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  }
  
  
  async function testTextStyles(canvas, display, color1, color2) {
  
      // Canvas supports chaining and operations are added to a queue.
      // Therefore, one can do multiple operations as needed using 'dot' chaining.
      // At the end of one's work, one can simply await the canvas to complete all operations.
  
      canvas.setTextSize(1)                  // Normal 1:1 pixel scale
            .setTextColor(color1)     // Draw colored text
            .setCursor(0,0)                  // Start at top-left corner
            .println("Hello, world!");
  
      canvas.setTextColor(color1, color2) // Draw with background.
            .println(3.141592);
  
      canvas.setTextSize(2)             // Draw 2X-scale text
            .setTextColor(color1)
            .println("0x%s", 0xDEADBEEF.toString(16).padStart(8,"0").toUpperCase());
  
      // Wait for canvas to complete all work.
      await canvas;
      await display.fastRenderGFXcanvas16(canvas);
      await delay(500);
  };
  
  
  async function testAnimate(canvas, display, bitmap, bitmapWidth, bitmapHeight, animateTimeMs = 30000) {
      const NUMFLAKES=10,
            // Indexes into the 'icons' array
            XPOS   = 0,
            YPOS   = 1,
            DELTAY = 2;
  
      const w = canvas.width(), h = canvas.height();
  
  
      let f, icons = [], color = 100;
  
      // Initialize 'snowflake' positions
      for(f=0; f< NUMFLAKES; f++) {
          const icon = [];
          // Create a random integer between 1 - LOGO_WIDTH and w.
          icon[XPOS]   = randomInteger(1 - LOGO_WIDTH, w);
          icon[YPOS]   = -LOGO_HEIGHT;
          // Create a random between 1 and 6.
          icon[DELTAY] = randomInteger(1, 6);
          //console.log(" x:%o", icon[XPOS]);
          //console.log(" y:%o", icon[YPOS]);
          //console.log("dy:%o", icon[DELTAY]);
          icons.push(icon);
      }
      const startTimeMs = new Date().valueOf();
  
      while ((new Date().valueOf() - startTimeMs) <= animateTimeMs) {
          canvas.fillScreen(BLACK);
  
          // Draw each snowflake:
          for(f=0; f< NUMFLAKES; f++) {
              //canvas.drawBitmap(
              await canvas.draw1BitBitmap(icons[f][XPOS], icons[f][YPOS], bitmap, bitmapWidth, bitmapHeight, color);
              color += 1100;
          }
  
          await display.fastRenderGFXcanvas16(canvas);
          await delay(5);        // Pause for 5ms
  
          // Then update coordinates of each flake...
          for(f=0; f< NUMFLAKES; f++) {
              icons[f][YPOS] += icons[f][DELTAY];
              // If snowflake is off the bottom of the screen...
              if (icons[f][YPOS] >= h) {
                  // Reinitialize to a random position, just off the top
                  icons[f][XPOS]   = randomInteger(1 - LOGO_WIDTH, w);
                  icons[f][YPOS]   = 0;
                  icons[f][DELTAY] = randomInteger(1, 6);
              }
          }
      }
      await delay(500);
  }
  
  
  async function testDrawBitmap(canvas, display, color) {
      const w = canvas.width(), h = canvas.height();
  
      //canvas.drawBitmap(
      await canvas.draw1BitBitmap((w  - LOGO_WIDTH ) / 2,
                                   (h - LOGO_HEIGHT) / 2,
                                   LOGO_BMP,
                                   LOGO_WIDTH,
                                   LOGO_HEIGHT, color);
      await display.fastRenderGFXcanvas16(canvas);
      await delay(1500);
  };
  
  
  const LOGO_HEIGHT  = 16;
  const LOGO_WIDTH   = 16;
  
  const LOGO_BMP = [
    0b00000000, 0b11000000,
    0b00000001, 0b11000000,
    0b00000001, 0b11000000,
    0b00000011, 0b11100000,
    0b11110011, 0b11100000,
    0b11111110, 0b11111000,
    0b01111110, 0b11111111,
    0b00110011, 0b10011111,
    0b00011111, 0b11111100,
    0b00001101, 0b01110000,
    0b00011011, 0b10100000,
    0b00111111, 0b11100000,
    0b00111111, 0b11110000,
    0b01111100, 0b11110000,
    0b01110000, 0b01110000,
    0b00000000, 0b00110000
  ];
  
  
  module.exports = {
      lcdTestPattern,
      testDrawText,
      tftPrintTest,
      testLines,
      testFastLines,
      testDrawRects,
      testFillRects,
      testFillCircles,
      testDrawCircles,
      testRoundRects,
      testTriangles,
      testMediaButtons,
      testCP437CharacterSet,
      testTextStyles,
      testDrawBitmap,
      /* exported for use with testAnimate */
      LOGO_BMP,
      LOGO_HEIGHT,
      LOGO_WIDTH,
      testAnimate // suggest only run if using a buffer-backed display/canvas such as SSD1327 or SSD1306.
  };