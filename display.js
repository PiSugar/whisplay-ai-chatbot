const { Adafruit_ST7789_Module: Adafruit_ST7789 } = require("@lynniemagoo/adafruit-st7735-library");

'use strict';
const Adafruit_GFX_Library = require("@lynniemagoo/adafruit-gfx-library");
const delay = Adafruit_GFX_Library.Utils.sleepMs;
const {GFXcanvas16} = Adafruit_GFX_Library.Canvas;



// Color definitions
const BLACK   = 0x0000;
const BLUE    = 0x001F;
const RED     = 0xF800;
const GREEN   = 0x07E0;
const CYAN    = 0x07FF;
const MAGENTA = 0xF81F;
const YELLOW  = 0xFFE0;
const WHITE   = 0xFFFF;


const {
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
    testAnimate // suggest only run if using a buffer-backed display such as SSD1327 or SSD1306.
} = require("./common/canvas_common");

function createDisplayOptions(namedDisplayType) {
    let displayOptions = null;
    switch(namedDisplayType.toUpperCase()) {
        case "ADAFRUIT-3787":
        case "ADAFRUIT-4313":
            displayOptions = {
                width:240,
                height:240,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:60000000
            }
            break;

        case "ADAFRUIT-4311":
            displayOptions = {
                width:240,
                height:320,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:60000000
            }
            break;

        case "ADAFRUIT-4383":
            displayOptions = {
                width:135,
                height:240,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:60000000
            }
            break;

        case "ADAFRUIT-5206":
            displayOptions = {
                width:280,
                height:240,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:60000000
            }
            break;

        case "ADAFRUIT-5393":
            displayOptions = {
                width:320,
                height:172,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:60000000
            }
            break;

        case "ADAFRUIT-5394":
            displayOptions = {
                width:320,
                height:170,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:60000000
            }
            break;
        case "WAVESHARE-240-240":
            // WaveShare ST7789 requires reversal of InversionMode.
            displayOptions = {
                width:240,
                height:240,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:64000000,
                reverseInversionMode:true
            }
            break;

        case "WAVESHARE-240-320":
            // WaveShare ST7789 requires reversal of InversionMode.
            displayOptions = {
                width:240,
                height:320,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:64000000,
                reverseInversionMode:true
            }
            break;

        case "WAVESHARE-135-240":
            // WaveShare ST7789 requires reversal of InversionMode.
            displayOptions = {
                width:135,
                height:240,
                rotation:0,
                dcGpioNb:24,  // If module requires Data/Clock GPIO, specify it (-1 is default)
                rstGpioNb:25, // If desire is to have hardware reset controlled by this module,
                              // by this module, set this value. (-1 is default)
                              // if set to -1 then will not be used.
                spiBusNumber:0,
                spiDeviceNumber:0,
                spiMaxSpeedHz:64000000,
                reverseInversionMode:true
            }
            break;

        default:
            break;
    }
    if (!displayOptions) throw new Error(`Unknown display type:${namedDisplayType}`);
    return displayOptions;
}

async function main() {
    const displayType = "ADAFRUIT-5206";
    //const displayType = "WAVESHARE-240-240";
    const displayOptions = createDisplayOptions(displayType);
    const display = new Adafruit_ST7789(displayOptions);
    console.log("SPI Modes:", Adafruit_ST7789.SPI_MODES);
    console.log("SPI Defaults:", Adafruit_ST7789.SPI_DEFAULTS);

    // Startup display - same as original adafruit begin() but options specified in the constructor.
    await display.startup();
    await delay(1000);

    let count = 4,
        rotation = 0,
        step_delay = 2000;

    while (count--) {
        // When using a Canvas, set either the rotation of the display or the rotation of the Canvas,
        // But NOT both.

        //await display.setRotation(rotation);
        console.log("rotation:%d", rotation);
        const w = display.width(), h = display.height();
        const canvasOptions = {
            width:w,
            height:h,
            rotation:rotation
        };
        const canvas = new GFXcanvas16(canvasOptions);

        await canvas.fillScreen(BLACK);
        await lcdTestPattern(canvas, display);
        await delay(step_delay);

        await display.invertDisplay(true);
        await delay(step_delay);
        await display.invertDisplay(false);
        await delay(step_delay);

        await canvas.fillScreen(BLACK);
        await testCP437CharacterSet(canvas, display, CYAN);
        await delay(step_delay);

        await canvas.fillScreen(BLACK);
        await testDrawText(canvas, display,
                           "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
                           "Curabitur adipiscing ante sed nibh tincidunt feugiat. " +
                           "Maecenas enim massa, fringilla sed malesuada et, malesuada " +
                           "sit amet turpis. Sed porttitor neque ut ante pretium vitae " +
                           "malesuada nunc bibendum. Nullam aliquet ultrices massa eu hendrerit. " +
                           "Ut sed nisi lorem. In vestibulum purus a tortor imperdiet posuere. ", WHITE);
        await delay(step_delay);

        await canvas.fillScreen(BLACK);
        await testTextStyles(canvas, display, BLUE, WHITE);
        await delay(step_delay);

        await tftPrintTest(canvas, display);
        await delay(step_delay);

        await canvas.drawPixel(canvas.width()/2, canvas.height()/2, GREEN);
        await display.fastRenderGFXcanvas16(canvas);
        await delay(step_delay);

        await canvas.fillScreen(BLACK);
        await testDrawBitmap(canvas, display, GREEN);
        await delay(step_delay);

        await testLines(canvas, display, YELLOW);
        await delay(step_delay);

        await testFastLines(canvas, display, RED, BLUE);
        await delay(step_delay);

        await testDrawRects(canvas, display, GREEN);
        await delay(step_delay);

        await testFillRects(canvas, display, YELLOW, MAGENTA);
        await delay(step_delay);

        await canvas.fillScreen(BLACK);
        await testFillCircles(canvas, display, 10, BLUE);
        await testDrawCircles(canvas, display, 10, WHITE);
        await delay(step_delay);

        await testRoundRects(canvas, display);
        await delay(step_delay);

        await testTriangles(canvas, display);
        await delay(step_delay);

        await testMediaButtons(canvas, display);
        await delay(step_delay);

        // Do 10 seconds of animation. - only run this on a buffer-backed display (SSD1327, SSD1306) or canvas.
        await testAnimate(canvas, display, LOGO_BMP, LOGO_WIDTH, LOGO_HEIGHT, 10000);

        rotation +=1;
    }
    await delay(1000);
    await display.setRotation(0);
    await display.shutdown();
}

module.exports = {
  main,
}