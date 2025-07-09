const { ethers } = require("ethers");
const colors = require("colors");
const fs = require("fs");
const config = require('./config');

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0x3a98250F98Dd388C211206983453837C8365BDc1";
const gasLimitDeposit = 500000;
const gasLimitRedeem = 800000;
const gasLimitBond = 600000;

const contractABI = [
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      { "name": "assets", "type": "uint256", "internalType": "uint256" },
      { "name": "receiver", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "redeem",
    "inputs": [
      { "name": "shares", "type": "uint256", "internalType": "uint256" },
      { "name": "receiver", "type": "address", "internalType": "address" },
      { "name": "owner", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "account", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bond",
    "inputs": [
      { "name": "policyID", "type": "uint64", "internalType": "uint64" },
      { "name": "bondRecipient", "type": "address", "internalType": "address" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
];

function readPrivateKeys() {
  try {
    const data = fs.readFileSync(WALLET_FILE, 'utf8');
    const privateKeys = data.split('\n')
      .map(key => key.trim())
      .filter(key => key !== '');
    if (privateKeys.length === 0) {
      console.error("No private keys found in wallet.txt".red);
      process.exit(1);
    }
    return privateKeys;
  } catch (error) {
    console.error(`❌ Unable to read wallet.txt file: ${error.message}`.red);
    process.exit(1);
  }
}

// Accept mon value from CLI arg if provided
async function getRandomAmount(wallet) {
  const controllerMonArg = process.argv[2];
  if (controllerMonArg) {
    return ethers.utils.parseEther(controllerMonArg);
  }
  try {
    const balance = await wallet.getBalance();
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    const min = balance.mul(minPercentage * 10).div(1000);
    const max = balance.mul(maxPercentage * 10).div(1000);
    if (min.lt(ethers.utils.parseEther(config.minimumTransactionAmount))) {
      console.log("Balance too low, using minimum amount".yellow);
      return ethers.utils.parseEther(config.minimumTransactionAmount);
    }
    const range = max.sub(min);
    const randomBigNumber = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).mod(range);
    return min.add(randomBigNumber);
  } catch (error) {
    console.error("❌ Error calculating random amount:".red, error.message);
    return ethers.utils.parseEther(config.defaultTransactionAmount);
  }
}

function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 1 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function depositMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Starting deposit MON...`.magenta);
    const depositAmount = await getRandomAmount(wallet);
    console.log(
      `Random deposit amount: ${ethers.utils.formatEther(depositAmount)} MON (${config.transactionLimits.minPercentage}-${config.transactionLimits.maxPercentage}% balance)`
    );
    const contract = new ethers.Contract(contractAddress, contractABI, wallet);
    const txResponse = await contract.deposit(
      depositAmount,
      wallet.address,
      {
        value: depositAmount,
        gasLimit: ethers.utils.hexlify(gasLimitDeposit)
      }
    );
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow);
    await txResponse.wait();
    console.log(`✔️ Deposit successful!`.green.underline);
    return depositAmount;
  } catch (error) {
    console.error("❌ Deposit failed:".red, error.message);
    throw error;
  }
}

async function getShmonBalance(wallet) {
  try {
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    return await contract.balanceOf(wallet.address);
  } catch (error) {
    console.error("❌ Error checking shMON balance:".red, error.message);
    throw error;
  }
}

async function redeemShMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to redeem shMON...`.magenta);
    const shmonBalance = await getShmonBalance(wallet);
    const redeemAmount = shmonBalance.mul(98).div(100);
    if (redeemAmount.lte(0)) {
      console.log("No shMON to redeem".yellow);
      return null;
    }
    const contract = new ethers.Contract(contractAddress, contractABI, wallet);
    const txResponse = await contract.redeem(
      redeemAmount,
      wallet.address,
      wallet.address,
      {
        gasLimit: ethers.utils.hexlify(gasLimitRedeem)
      }
    );
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow);
    await txResponse.wait();
    console.log(`✔️ Redeem successful!`.green.underline);
    return redeemAmount;
  } catch (error) {
    console.error("❌ Redeem failed:".red, error.message);
    throw error;
  }
}

async function bondShMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to bond shMON...`.magenta);
    const shmonBalance = await getShmonBalance(wallet);
    const bondAmount = shmonBalance.mul(50).div(100);
    if (bondAmount.lte(0)) {
      console.log("No shMON to bond".yellow);
      return null;
    }
    const contract = new ethers.Contract(contractAddress, contractABI, wallet);
    const policyID = 4; // Default PolicyID
    const txResponse = await contract.bond(
      policyID,
      wallet.address,
      bondAmount,
      {
        gasLimit: ethers.utils.hexlify(gasLimitBond)
      }
    );
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow);
    await txResponse.wait();
    console.log(`✔️ Bond successful!`.green.underline);
    return bondAmount;
  } catch (error) {
    console.error("❌ Bond failed:".red, error.message);
    throw error;
  }
}

async function processWallet(privateKey, cycles) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const truncatedAddress = `${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)}`;
    console.log(`\n👤 Processing wallet: ${truncatedAddress}`.cyan);
    for (let i = 1; i <= cycles; i++) {
      await depositMON(wallet, i);
      const delayTimeRedeem = getRandomDelay();
      await delay(delayTimeRedeem);
      await redeemShMON(wallet, i);
      const delayTimeBond = getRandomDelay();
      await delay(delayTimeBond);
      await bondShMON(wallet, i);
    }
  } catch (error) {
    console.error(`❌ Error processing wallet: ${error.message}`.red);
  }
}

async function processAllAccounts(cycles, intervalHours) {
  const privateKeys = readPrivateKeys();
  for (const [i, privateKey] of privateKeys.entries()) {
    console.log(`\n🔄 Processing wallet ${i + 1} of ${privateKeys.length}`.cyan);
    await processWallet(privateKey, cycles);
    if (i < privateKeys.length - 1) {
      console.log(`⏱️ Waiting ${ACCOUNT_SWITCH_DELAY / 1000} seconds before switching wallets...`.cyan);
      await delay(ACCOUNT_SWITCH_DELAY);
    }
  }
  if (intervalHours) {
    console.log(`⏱️ Next run scheduled in ${intervalHours} hours`.cyan);
    setTimeout(() => processAllAccounts(cycles, intervalHours), intervalHours * 60 * 60 * 1000);
  }
}

if (require.main === module) {
  const cyclesArg = parseInt(process.argv[3], 10) || 1;
  const intervalArg = parseInt(process.argv[4], 10) || null;
  processAllAccounts(cyclesArg, intervalArg);
}

module.exports = {
  processAllAccounts,
  depositMON,
  redeemShMON,
  bondShMON,
  getRandomAmount,
  getRandomDelay,
};
