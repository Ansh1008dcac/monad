const ethers = require("ethers");
const colors = require("colors");
const fs = require("fs");
const config = require("./config");
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0x3a98250F98Dd388C211206983453837C8365BDc1";
const gasLimitDeposit = 500000;
const gasLimitRedeem = 800000;
const gasLimitBond = 600000;

const contractABI = [
  {"type":"function","name":"deposit","inputs":[{"name":"assets","type":"uint256"},{"name":"receiver","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"payable"},
  {"type":"function","name":"redeem","inputs":[{"name":"shares","type":"uint256"},{"name":"receiver","type":"address"},{"name":"owner","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"balanceOf","inputs":[{"name":"account","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"bond","inputs":[{"name":"policyID","type":"uint64"},{"name":"bondRecipient","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"}
];

function readPrivateKeys() {
  try {
    const data = fs.readFileSync("wallet.txt", "utf8");
    return data.split("\n").map(k => k.trim()).filter(Boolean);
  } catch (err) {
    console.error("❌ Cannot read wallet.txt".red, err.message);
    process.exit(1);
  }
}

async function getRandomAmount(wallet) {
  const balance = await provider.getBalance(wallet.address);
  const min = balance.mul(config.transactionLimits.minPercentage * 10).div(1000);
  const max = balance.mul(config.transactionLimits.maxPercentage * 10).div(1000);
  if (min.lt(ethers.utils.parseEther(config.minimumTransactionAmount))) return ethers.utils.parseEther(config.minimumTransactionAmount);
  const range = max.sub(min);
  const rand = ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(range);
  return min.add(rand);
}

const delay = ms => new Promise(r => setTimeout(r, ms));
const getRandomDelay = () => Math.floor(Math.random() * (60000 - 30000 + 1) + 30000);

async function depositMON(wallet, cycle) {
  const amount = await getRandomAmount(wallet);
  const contract = new ethers.Contract(contractAddress, contractABI, wallet);
  console.log(`[Cycle ${cycle}] Depositing ${ethers.utils.formatEther(amount)} MON`.cyan);
  const tx = await contract.deposit(amount, wallet.address, { value: amount, gasLimit: gasLimitDeposit });
  console.log(`➡️ TX: ${EXPLORER_URL}${tx.hash}`.yellow);
  await tx.wait();
  console.log("✔️ Deposit confirmed".green);
}

async function getShmonBalance(wallet) {
  const contract = new ethers.Contract(contractAddress, contractABI, provider);
  return await contract.balanceOf(wallet.address);
}

async function redeemShMON(wallet, cycle) {
  const shmonBalance = await getShmonBalance(wallet);
  const redeemAmt = shmonBalance.mul(98).div(100);
  if (redeemAmt.lte(0)) return console.log("No shMON to redeem".yellow);
  const contract = new ethers.Contract(contractAddress, contractABI, wallet);
  console.log(`[Cycle ${cycle}] Redeeming ${ethers.utils.formatEther(redeemAmt)} shMON`.cyan);
  const tx = await contract.redeem(redeemAmt, wallet.address, wallet.address, { gasLimit: gasLimitRedeem });
  console.log(`➡️ TX: ${EXPLORER_URL}${tx.hash}`.yellow);
  await tx.wait();
  console.log("✔️ Redeem confirmed".green);
}

async function bondShMON(wallet, cycle) {
  const shmonBalance = await getShmonBalance(wallet);
  const bondAmt = shmonBalance.mul(50).div(100);
  if (bondAmt.lte(0)) return console.log("No shMON to bond".yellow);
  const contract = new ethers.Contract(contractAddress, contractABI, wallet);
  console.log(`[Cycle ${cycle}] Bonding ${ethers.utils.formatEther(bondAmt)} shMON`.cyan);
  const tx = await contract.bond(4, wallet.address, bondAmt, { gasLimit: gasLimitBond });
  console.log(`➡️ TX: ${EXPLORER_URL}${tx.hash}`.yellow);
  await tx.wait();
  console.log("✔️ Bond confirmed".green);
}

async function runCycle(wallet, cycle) {
  await depositMON(wallet, cycle);
  await delay(getRandomDelay());
  await redeemShMON(wallet, cycle);
  await delay(getRandomDelay());
  await bondShMON(wallet, cycle);
}

async function processAccount(privateKey, cycleCount) {
  if (!privateKey.startsWith("0x")) privateKey = "0x" + privateKey;
  const wallet = new ethers.Wallet(privateKey, provider);
  for (let i = 1; i <= cycleCount; i++) {
    console.log(`\n🔁 Running Cycle ${i} for ${wallet.address}`.blue);
    await runCycle(wallet, i);
    if (i < cycleCount) await delay(getRandomDelay());
  }
}

async function processAllAccounts(cycleCount, intervalHours) {
  const keys = readPrivateKeys();
  for (const key of keys) await processAccount(key, cycleCount);
  if (intervalHours) {
    console.log(`⏳ Next run in ${intervalHours} hour(s)...`.cyan);
    setTimeout(() => processAllAccounts(cycleCount, intervalHours), intervalHours * 60 * 60 * 1000);
  }
}

async function runAutomated(cycles = 1, intervalHours = null) {
  await processAllAccounts(cycles, intervalHours);
  return true;
}

module.exports = {
  runAutomated,
  depositMON,
  redeemShMON,
  bondShMON,
  getRandomAmount,
  getRandomDelay
};

if (require.main === module) {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("How many cycles per account? ", ans => {
    const cycles = parseInt(ans);
    if (isNaN(cycles) || cycles <= 0) return process.exit(1);
    rl.question("Interval in hours (Enter for none): ", hours => {
      const interval = hours ? parseInt(hours) : null;
      rl.close();
      processAllAccounts(cycles, interval);
    });
  });
}
