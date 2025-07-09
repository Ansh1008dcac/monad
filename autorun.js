// scripts/auto_controller.js
// Controller to run all dapp scripts every random 24–26 hours with random mon, delay, and cycles.
// Excludes contract deployment (deployct)

const { execFile } = require('child_process');
const path = require('path');

// List all dapp scripts here, EXCLUDE contract deploy script!
const SCRIPTS = [
  'rubic.js',
  'izumi.js',
  'beanswap.js',
  'magma.js',
  'apriori.js',
  'monorail.js',
  'ambient.js',
  'kintsu.js',
  'shmonad.js',
  'octoswap.js',
];

// Directory containing your scripts
const SCRIPTS_DIR = path.join(__dirname);

// Helper: Random float between min and max (inclusive)
function randomFloat(min, max, decimals = 4) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

// Helper: Random integer between min and max (inclusive)
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper: Delay for ms milliseconds
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper: Run a script with arguments
function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    execFile('node', [scriptPath, ...args], (error, stdout, stderr) => {
      if (error) {
        console.error(`Error running ${scriptName}:`, error.message);
        return reject(error);
      }
      console.log(`[${scriptName}] stdout:\n${stdout}`);
      if (stderr) console.error(`[${scriptName}] stderr:\n${stderr}`);
      resolve();
    });
  });
}

// Main controller logic
async function mainLoop() {
  while (true) {
    console.log('\n=== New Cycle ===');

    for (const script of SCRIPTS) {
      // Random number of cycles per script (1–3)
      const cycles = randomInt(1, 3);

      for (let i = 0; i < cycles; i++) {
        // Random value of mon (0.01–0.1)
        const monValue = randomFloat(0.01, 0.1);

        // Random delay between interactions (5–30s)
        const randDelaySec = randomInt(5, 30);
        console.log(`[${script}] [Cycle ${i + 1}/${cycles}] Sleeping for ${randDelaySec}s...`);
        await delay(randDelaySec * 1000);

        // Run the script with the mon amount as an argument (if script supports it)
        // You may need to adapt your scripts to read mon value from process.argv[2]
        console.log(`[${script}] [Cycle ${i + 1}/${cycles}] Running with mon = ${monValue}`);
        try {
          await runScript(path.join('scripts', script), [monValue]);
        } catch (err) {
          console.error(`Script ${script} failed, continuing to next.`);
        }
      }
    }

    // Random interval for next full run (24–26h)
    const intervalHrs = randomFloat(24, 26, 2);
    const intervalMs = intervalHrs * 60 * 60 * 1000;
    console.log(`\nSleeping for ${intervalHrs.toFixed(2)} hours before next cycle...`);
    await delay(intervalMs);
  }
}

mainLoop().catch((err) => {
  console.error('Fatal error in controller:', err);
  process.exit(1);
});
