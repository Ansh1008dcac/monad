const { ethers } = require("ethers");
const colors = require("colors");
const fs = require("fs");
const config = require('./config');

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const TX_EXPLORER = "https://testnet.monadexplorer.com/tx/";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

const ROUTER_CONTRACT = "0xb6091233aAcACbA45225a2B2121BBaC807aF4255";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const USDC_CONTRACT = "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea";
const USDT_CONTRACT = "0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D";
const TEST1_CONTRACT = "0xe42cFeCD310d9be03d3F80D605251d8D0Bc5cDF3";
const TEST2_CONTRACT = "0x73c03bc8F8f094c61c668AE9833D7Ed6C04FDc21";
const DAK_CONTRACT = "0x0F0BDEbF0F83cD1EE3974779Bcb7315f9808c714";

const availableTokens = {
  MON:   { name: "MON",   address: null,           decimals: 18, native: true  },
  WMON:  { name: "WMON",  address: WMON_CONTRACT,  decimals: 18, native: false },
  USDC:  { name: "USDC",  address: USDC_CONTRACT,  decimals: 6,  native: false },
  DAK:   { name: "DAK",   address: DAK_CONTRACT,   decimals: 18, native: false },
  USDT:  { name: "USDT",  address: USDT_CONTRACT,  decimals: 6,  native: false },
  TEST1: { name: "TEST1", address: TEST1_CONTRACT, decimals: 18, native: false },
  TEST2: { name: "TEST2", address: TEST2_CONTRACT, decimals: 18, native: false }
};

const ABI = {
  router: [
    {
      "type": "function",
      "name": "getAmountsOut",
      "inputs": [
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "address[]", "name": "path", "type": "address[]" }
      ],
      "outputs": [
        { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "swapExactETHForTokens",
      "inputs": [
        { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
        { "internalType": "address[]", "name": "path", "type": "address[]" },
        { "internalType": "address", "name": "to", "type": "address" },
        { "internalType": "uint256", "name": "deadline", "type": "uint256" }
      ],
      "outputs": [
        { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }
      ],
      "stateMutability": "payable"
    },
    {
      "type": "function",
      "name": "swapExactTokensForETH",
      "inputs": [
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
        { "internalType": "address[]", "name": "path", "type": "address[]" },
        { "internalType": "address", "name": "to", "type": "address" },
        { "internalType": "uint256", "name": "deadline", "type": "uint256" }
      ],
      "outputs": [
        { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "swapExactTokensForTokens",
      "inputs": [
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
        { "internalType": "address[]", "name": "path", "type": "address[]" },
        { "internalType": "address", "name": "to", "type": "address" },
        { "internalType": "uint256", "name": "deadline", "type": "uint256" }
      ],
      "outputs": [
        { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }
      ],
      "stateMutability": "nonpayable"
    }
  ]
};

const ROUTER_ABI = ABI.router;

function readPrivateKeys() {
  try {
    const data = fs.readFileSync(WALLET_FILE, 'utf8');
    const privateKeys = data.split('\n').map(key => key.trim()).filter(key => key !== '');
    if (privateKeys.length === 0) {
      console.error("No private keys found in wallet.txt".red);
      process.exit(1);
    }
    return privateKeys;
  } catch (error) {
    console.error(`❌ Could not read wallet.txt file: ${error.message}`.red);
    process.exit(1);
  }
}

async function getRandomAmount(wallet, token, minThreshold = "0.0001") {
  const controllerMonArg = process.argv[2];
  if (controllerMonArg) return ethers.utils.parseEther(controllerMonArg);

  try {
    const balance = token.native
      ? await wallet.getBalance()
      : await new ethers.Contract(token.address, ROUTER_ABI, wallet).balanceOf(wallet.address);

    const minPercentage = config.transactionLimits.minPercentage || 10;
    const maxPercentage = config.transactionLimits.maxPercentage || 50;

    const min = balance.mul(minPercentage * 10).div(1000);
    const max = balance.mul(maxPercentage * 10).div(1000);

    const minAmount = ethers.utils.parseUnits(minThreshold, token.decimals);
    if (min.lt(minAmount)) return null; // Insufficient balance

    const range = max.sub(min);
    const randomValue = ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(range);
    return min.add(randomValue);
  } catch (error) {
    console.error(`❌ Error calculating random amount for ${token.name}: ${error.message}`.red);
    return null;
  }
}

async function performSwapCycle(wallet) {
  try {
    const tokenKeys = Object.keys(availableTokens);
    let tokenAKey, tokenBKey;

    do {
      tokenAKey = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
      tokenBKey = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
    } while (tokenAKey === tokenBKey);

    const tokenA = availableTokens[tokenAKey];
    const tokenB = availableTokens[tokenBKey];

    console.log(`🔄 Selected swap pair: ${tokenA.name} → ${tokenB.name}`.cyan);
    const amountIn = await getRandomAmount(wallet, tokenA);
    if (!amountIn) {
      console.log(`⚠️ Insufficient balance for ${tokenA.name} swap`.yellow);
      return false;
    }

    const routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, wallet);
    const path = [tokenA.address || WMON_CONTRACT, tokenB.address || WMON_CONTRACT];
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const tx = await routerContract.swapExactTokensForTokens(amountIn, 0, path, wallet.address, deadline);
    console.log(`🚀 Swap Tx sent: ${TX_EXPLORER}${tx.hash}`.yellow);
    await tx.wait();
    console.log(`✅ Swap ${tokenA.name} → ${tokenB.name} successful`.green);
    return true;
  } catch (error) {
    console.error(`❌ Swap cycle failed: ${error.message}`.red);
    return false;
  }
}

async function runSwapCyclesForAccount(privateKey, cycles) {
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`\n👤 Processing account: ${wallet.address.substring(0, 6)}...`);

  for (let i = 0; i < cycles; i++) {
    const success = await performSwapCycle(wallet);
    if (!success) {
      console.log(`⚠️ Cycle ${i + 1} failed, skipping to next`.yellow);
      continue;
    }
    if (i < cycles - 1) await delay(ACCOUNT_SWITCH_DELAY);
  }
}

async function processAllAccounts(cycles, interval) {
  const privateKeys = readPrivateKeys();
  for (const privateKey of privateKeys) {
    await runSwapCyclesForAccount(privateKey, cycles);
    await delay(ACCOUNT_SWITCH_DELAY);
  }

  if (interval) {
    console.log(`⏱️ Next run scheduled in ${interval} hours`.cyan);
    setTimeout(() => processAllAccounts(cycles, interval), interval * 3600 * 1000);
  }
}

if (require.main === module) {
  const cycles = parseInt(process.argv[3], 10) || 1;
  const interval = parseInt(process.argv[4], 10) || null;
  processAllAccounts(cycles, interval);
}

module.exports = { processAllAccounts };
