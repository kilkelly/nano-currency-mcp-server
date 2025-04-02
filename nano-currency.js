/*
 * Nano Currency MCP Server
 * Provides tools to send Nano and retrieve account / block info via Nano node RPC
 *   nano_send - Send a specified amount of Nano currency
 *   nano_account_info - Retrieve detailed information about a specific Nano account/address
 *   nano_my_account_info - Retrieve detailed information about your predefined Nano account/address
 *   block_info - Retrieve detailed information about a specific Nano block
 * 
 * Required environment variables:
 *    - NANO_RPC_URL
 * 
 * Optional environment variables:
 *    - NANO_PRIVATE_KEY (Required for nano_send, nano_my_account_info. This is the private key for an address, NOT the wallet seed)
 *    - NANO_WORK_GENERATION_URL (Optional for nano_send; defaults to NANO_RPC_URL if not set)
 *    - NANO_MAX_SEND_AMOUNT (In nano units. Defaults to 0.01, use this variable to override the default)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import z from 'zod'
import * as N from 'nanocurrency'
import BigNumber from "bignumber.js"

const SERVER_NAME = 'nano_currency'
const VERSION = '1.0.0'

const NANO_MAX_SEND_AMOUNT_DEFAULT = 0.01

const FETCH_COMMON = {
  method: "POST",
  headers: {
    'Content-Type': 'application/json'
  }
}

const ONE_SECOND = 1000 // in milliseconds
const ONE_MINUTE = 60 * ONE_SECOND

const NANO_RPC_URL_KEY = 'NANO_RPC_URL'
const NANO_WORK_GENERATION_URL_KEY = 'NANO_WORK_GENERATION_URL'

// -----

const NANO_PRIVATE_KEY_SCHEMA = z.string({
  required_error: `NANO_PRIVATE_KEY is required`,
})
.refine(val => N.checkKey(val), { message: `NANO_PRIVATE_KEY is not valid` })

// -----

try {
  const envVarsToCheck = ['NANO_RPC_URL']

  for (let i = 0; i < envVarsToCheck.length; i++) {
    z.string({
      required_error: `${envVarsToCheck[i]} is required`,
    }).parse(process.env[envVarsToCheck[i]])
  }

} catch (error) {
  console.error('Error:', error.message || error);
  process.exit(1);
}

// -----

async function rpcCall(envUrl, action, payload, timeout = ONE_MINUTE) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(process.env[envUrl], {
      ...FETCH_COMMON,
      signal: controller.signal,
      body: JSON.stringify({ action, ...payload }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const json = await res.json()
    if (json.error) throw new Error(`RPC Error: ${json.error}`)
    return json
  } catch (error) {
    throw new Error(`[${envUrl}] ${error.message}`)
  } finally {
    clearTimeout(timer)
  }
}

// -----

function createTextResponse(text) {
  return {
    content: [
      {
        type: "text",
        text
      },
    ],
    metadata: { server: SERVER_NAME, version: VERSION }
  }
}

// -----

function createErrorResponse(error) {
  return {
    content: [
        {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
        },
    ],
    isError: true,
    errorCode: error instanceof McpError ? error.code : ErrorCode.INTERNAL_ERROR
  }
}

// -----

function convertRawToNano(amount) {
  return N.convert(String(amount), {from: 'raw', to: 'Nano'})
}

// -----

function convertNanoToRaw(amount) {  
  return N.convert(String(amount), {from: 'Nano', to: 'raw'})
}

// -----

function getAddress () {
  return N.deriveAddress(N.derivePublicKey(process.env.NANO_PRIVATE_KEY), { useNanoPrefix: true })
}

// -----

function friendlyAmount (balance) {
  return `${convertRawToNano(balance)} in nano units or ${balance} in raw units`
}

// -----

const server = new McpServer(
  {
    name: SERVER_NAME,
    version: VERSION
  }
)

// -----

async function getAccountInfo(address) {
  return (
    await rpcCall(
      NANO_RPC_URL_KEY,
      'account_info',
      {
        account: address,
        representative: 'true'
      }
    )
  )
}

// -----
// nano_send

const nano_send_parameters = {
  destination_address: z.string({
      required_error: `Destination address is required`,
    })
    .refine(address_ => N.checkAddress(address_), { message: 'Destination address is not valid' })
    .describe('Nano address to send the nano to'),
  amount: z.string({
      required_error: `Amount is required`,
    })
    .refine(amount_ => !isNaN(Number(amount_)) && Number(amount_) > 0, { message: 'Amount must be a positive number' })
    .transform(amount_ => Number(amount_))
    .refine(amount_ => amount_ <= (process.env.NANO_MAX_SEND_AMOUNT || NANO_MAX_SEND_AMOUNT_DEFAULT), { message: 'Maximum send amount exceeded' })
    .describe(`Amount of Nano to send (max ${(process.env.NANO_MAX_SEND_AMOUNT || NANO_MAX_SEND_AMOUNT_DEFAULT)} by default)`)
}

server.tool(
  'nano_send',
  'Send a specified amount of Nano currency from a predefined account to a destination Nano address',
  nano_send_parameters,
  async function (parameters) {
    
    NANO_PRIVATE_KEY_SCHEMA.parse(process.env.NANO_PRIVATE_KEY)

    try {      
      let amountInRaw = convertNanoToRaw(parameters.amount)
      let sourceAddress = getAddress()
      let sourceAddressInfo = await getAccountInfo(sourceAddress)
      let balanceAfterSend = BigNumber(sourceAddressInfo.balance).minus(amountInRaw).toFixed()

      if (BigNumber(sourceAddressInfo.balance).lt(amountInRaw)) {
        throw new Error("Insufficient balance to perform Nano send transaction");
      }

      if (!sourceAddressInfo.frontier) {
        throw new Error("Source account has no frontier (unopened account)");
      }

      // ----- 

      let work = (
        await rpcCall(
          (process.env.NANO_WORK_GENERATION_URL ? NANO_WORK_GENERATION_URL_KEY : NANO_RPC_URL_KEY),
          'work_generate',
          { hash: sourceAddressInfo.frontier },
          5 * ONE_MINUTE
        )
      ).work      

      z.string({
        required_error: `Work is required`,
      }).refine(work_ => N.validateWork({ work: work_, blockHash: sourceAddressInfo.frontier }), { message: 'Computed Proof-of-Work for Nano transaction is not valid' }).parse(work)
  
      // -----
  
      let { block } = N.createBlock(process.env.NANO_PRIVATE_KEY, {
        representative: sourceAddressInfo.representative,
        balance: balanceAfterSend,
        work,
        link: parameters.destination_address,
        previous: sourceAddressInfo.frontier
      })

      let processJson = (
        await rpcCall(
          NANO_RPC_URL_KEY,
          'process',
          {
            json_block: 'true',
            subtype: 'send',
            block
          }
        )
      )        

      return createTextResponse(JSON.stringify(processJson))      
    }
    catch (error) {
      console.error('[nano_send] Error:', error.message || error);
      return createErrorResponse(error)
    }
  }
)

// -----
// nano_account_info

const nano_account_info_parameters = {
  address: z.string({ required_error: 'Address is required' })
    .refine(address_ => N.checkAddress(address_), { message: 'Nano address is not valid' })
    .describe("Nano address/account to get information about")
}

server.tool(
  'nano_account_info',
  'Retrieve detailed information about a specific Nano account/address, including balance (in Nano and raw units), representative, and frontier block',
  nano_account_info_parameters,
  async function (parameters) {  
    try {
      let accountInfo =  await getAccountInfo(parameters.address)

      return createTextResponse(`The account information for ${parameters.address} is ` + JSON.stringify({ ...accountInfo, balance: friendlyAmount(accountInfo.balance) }))
    }
    catch (error) {
      console.error('[nano_account_info] Error:', error.message || error);
      return createErrorResponse(error)
    }    
  }
)

// -----
// nano_my_account_info

server.tool(
  'nano_my_account_info',
  'Retrieve detailed information about my Nano account/address, including balance (in Nano and raw units), representative, and frontier block. This is the account that is used to send Nano from.',
  {},
  async function () {  
    try {
      NANO_PRIVATE_KEY_SCHEMA.parse(process.env.NANO_PRIVATE_KEY)

      const myAddress = getAddress()
      let myAccountInfo =  await getAccountInfo(myAddress)

      return createTextResponse(`The account information for ${myAddress} is ` + JSON.stringify({ ...myAccountInfo, balance: friendlyAmount(myAccountInfo.balance) }))
    }
    catch (error) {
      console.error('[nano_my_account_info] Error:', error.message || error);
      return createErrorResponse(error)
    }    
  }
)

// -----
// block_info

const block_info_parameters = {
  hash: z.string({ required_error: 'Block hash is required' })
    .refine(hash_ => N.checkHash(hash_), { message: 'Block hash is not valid' })
    .describe("Hash for the Nano block to get information about")
}

server.tool(
  'block_info',
  'Retrieve detailed information about a specific Nano block',
  block_info_parameters,
  async function (parameters) {  
    try {

      let blockInfoJson = (
        await rpcCall(
          NANO_RPC_URL_KEY,
          'block_info',
          {
            json_block: 'true',
            hash: parameters.hash
          }
        )
      )        

      return createTextResponse(
        `The block information for hash ${parameters.hash} is ` +
        JSON.stringify({
          ...blockInfoJson,
          amount: blockInfoJson.amount ? friendlyAmount(blockInfoJson.amount) : 'N/A',
          balance: blockInfoJson.balance ? friendlyAmount(blockInfoJson.balance) : 'N/A'
        })
      )
    }
    catch (error) {
      console.error('[block_info] Error:', error.message || error);
      return createErrorResponse(error)
    }    
  }
)

// -----
  
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`${SERVER_NAME} MCP Server running on stdio`)
}

main().catch((error) => {
  console.error(`[startup] ${SERVER_NAME} MCP Server Error:`, error.message || error)
  process.exit(1)
});