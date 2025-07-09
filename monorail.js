const { ethers } = require("ethers");
const colors = require("colors");
const fs = require("fs");
const config = require('./config');
const axios = require("axios");

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

const ROUTER_CONTRACT = "0xC995498c22a012353FAE7eCC701810D673E25794";
const WMON_CONTRACT = "0x760afe86e5de5fa0ee542fc7b7b713e1c5425701";
const USDC_CONTRACT = "0xf817257fed379853cde0fa4f97ab987181b1e5ea";
const WETH_CONTRACT = "0xb5a30b0fdc5ea94a52fdc42e3e9760cb8449fb37";

const availableTokens = {
  MON: { name: "MON", address: null, decimals: 18, native: true },
  WMON: { name: "WMON", address: WMON_CONTRACT, decimals: 18, native: false },
  USDC: { name: "USDC", address: USDC_CONTRACT, decimals: 6, native: false },
  WETH: { name: "WETH", address: WETH_CONTRACT, decimals: 18, native: false },
};

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint amount) returns (bool)"
];

const WMON_ABI = [
  "function deposit() public payable",
  "function withdraw(uint256 amount) public",
  "function balanceOf(address owner) view returns (uint256)"
];

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(operation, operationName) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isServerError =
        error.code === 'SERVER_ERROR' ||
        (error.response && error.response.status >= 500) ||
        error.message.includes('503') ||
        error.message.includes('SERVER_ERROR');

      if (!isServerError && !error.message.includes('bad response')) {
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        console.log(`⚠️ ${operationName} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY / 1000} seconds...`.yellow);
        await delay(RETRY_DELAY);
      } else {
        console.log(`❌ ${operationName} failed after ${MAX_RETRIES} attempts: ${error.message}`.red);
      }
    }
  }
  throw lastError;
}

async function getRandomAmount(wallet, token) {
  const controllerMonArg = process.argv[2];
  if (controllerMonArg) return ethers.utils.parseEther(controllerMonArg);

  return await withRetry(async () => {
    let balance = token.native
      ? await wallet.getBalance()
      : await new ethers.Contract(token.address, ERC20_ABI, wallet).balanceOf(wallet.address);

    const minPercentage = config.transactionLimits.minPercentage || 10;
    const maxPercentage = config.transactionLimits.maxPercentage || 50;

    const min = balance.mul(minPercentage * 10).div(1000);
    const max = balance.mul(maxPercentage * 10).div(1000);

    const minAmount = ethers.utils.parseUnits("0.0001", token.decimals);
    if (min.lt(minAmount)) {
      console.log("⚠️ Balance too low, using minimum amount".yellow);
      return minAmount;
    }

    const range = max.sub(min);
    const randomValue = ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(range);
    return min.add(randomValue);
  }, `Calculating random amount for ${token.name}`);
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
    console.log(`🚀 Swap Tx sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    console.log(`✅ Swap ${tokenA.name} → ${tokenB.name} successful`.green);
    return true;
  } catch (error) {
    console.error(`❌ Swap cycle failed: ${error.message}`.red);
    return false;
  }
}

async function runSwapCyclesForAccount(privateKey, cycles) {
  const wallet = new ethers.Wallet(privateKey, new ethers.providers.JsonRpcProvider(RPC_URL));
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
