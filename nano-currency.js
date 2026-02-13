/*
 * Nano Currency MCP Server
 * Provides tools to send Nano and retrieve account / block info via Nano node RPC
 *   raw_send - Send a specified amount of Nano currency (in raw units)
 *   nano_send - Send a specified amount of Nano currency (in nano units)
 *   nano_account_info - Retrieve detailed information about a specific Nano account
 *   nano_my_account_info - Retrieve detailed information about your predefined Nano account
 *   block_info - Retrieve detailed information about a specific Nano block
 *   x402_payment_signature_exact_scheme_create - Create the PAYMENT-SIGNATURE header for Nano exact scheme x402 transaction.
 * 
 * Required environment variables:
 *    - NANO_RPC_URL
 * 
 * Optional environment variables:
 *    - NANO_PRIVATE_KEY (Required for nano_send, nano_my_account_info. This is the private key for an account, NOT the wallet seed)
 *    - NANO_WORK_GENERATION_URL (Optional for nano_send; defaults to NANO_RPC_URL if not set)
 *    - NANO_MAX_SEND_AMOUNT (In nano units. Defaults to 0.01, use this variable to override the default)
 *    - RAW_MAX_SEND_AMOUNT (In raw units. Defaults to 10000000000000000000000000000, use this variable to override the default)
 *    - X402_NANO_NETWORK (Defaults to "nano:mainnet")
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import z from 'zod'
import * as N from 'nanocurrency'
import BigNumber from "bignumber.js"
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { ExactNanoScheme } from '@x402nano/exact/client'
import { Helper } from '@x402nano/helper'

const SERVER_NAME = 'nano_currency'
const VERSION = '1.1.0'

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

const NANO_PRIVATE_KEY_SCHEMA = z.string({
  required_error: `NANO_PRIVATE_KEY is required`,
})
.refine(val => N.checkKey(val), { message: `NANO_PRIVATE_KEY is not valid` })

const BALANCE_NANO = z.string().regex(/^\d*\.\d+$/)
const BALANCE_RAW = z.string().regex(/^\d+$/)

const SUPPORTED_X402_VERSIONS = [2]

const NANO_MAX_SEND_AMOUNT_DEFAULT = '0.01'
const NANO_MAX_SEND_AMOUNT = ([process.env.NANO_MAX_SEND_AMOUNT || NANO_MAX_SEND_AMOUNT_DEFAULT]).map(function (value) {
  if (value.startsWith('.')) { // handle edge case where a decimal without leading zero is supplied
    return '0' + value
  }
  return value
})[0] 

const RAW_MAX_SEND_AMOUNT_DEFAULT = convertNanoToRaw(NANO_MAX_SEND_AMOUNT)
const RAW_MAX_SEND_AMOUNT = process.env.RAW_MAX_SEND_AMOUNT || RAW_MAX_SEND_AMOUNT_DEFAULT 

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

function getAccount () {
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

async function getAccountInfo(account) {
  return (
    await rpcCall(
      NANO_RPC_URL_KEY,
      'account_info',
      {
        account,
        representative: 'true'
      }
    )
  )
}

// -----

async function raw_send({
  destinationAccount,
  amountInRaw
}) {

  let sourceAccount = getAccount()
  let sourceAccountInfo = await getAccountInfo(sourceAccount)
  let balanceAfterSend = BigNumber(sourceAccountInfo.balance).minus(amountInRaw).toFixed()

  if (BigNumber(sourceAccountInfo.balance).lt(amountInRaw)) {
    throw new Error("Insufficient balance to perform Nano send transaction");
  }

  if (!sourceAccountInfo.frontier) {
    throw new Error("Source account has no frontier (unopened account)");
  }

  // ----- 

  let work = (
    await rpcCall(
      (process.env.NANO_WORK_GENERATION_URL ? NANO_WORK_GENERATION_URL_KEY : NANO_RPC_URL_KEY),
      'work_generate',
      { hash: sourceAccountInfo.frontier },
      5 * ONE_MINUTE
    )
  ).work      

  z.string({
    required_error: `Work is required`,
  }).refine(work_ => N.validateWork({ work: work_, blockHash: sourceAccountInfo.frontier }), { message: 'Computed Proof-of-Work for Nano transaction is not valid' }).parse(work)

  // -----

  let { block } = N.createBlock(process.env.NANO_PRIVATE_KEY, {
    representative: sourceAccountInfo.representative,
    balance: balanceAfterSend,
    work,
    link: destinationAccount,
    previous: sourceAccountInfo.frontier
  })

  return (
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

}

// -----
// raw_send

const raw_send_parameters = {
  destination_account: z.string({
      required_error: `Destination account is required`,
    })
    .refine(account_ => N.checkAddress(account_), { message: 'Destination account is not valid' })
    .describe('Nano account to send the raw units to'),
  amount: z.string({
      required_error: `Amount is required`,
    })
    .refine(amount_ => BALANCE_RAW.safeParse(amount_).success, { message: 'Amount must be in raw units, example 10000000000000000000000000000' })
    .transform(amount_ => BigNumber(amount_).toFixed())
    .describe(`Amount of raw units to send (max ${(RAW_MAX_SEND_AMOUNT)} by default). Raw units only, not nano units.`)
}

server.registerTool(
  'raw_send',
  {
    description: 'Send a specified amount of raw units from a predefined Nano account to a destination Nano account.',
    inputSchema: raw_send_parameters
  },  
  async function (parameters) {

    if (BigNumber(parameters.amount).gt(RAW_MAX_SEND_AMOUNT)) {
      throw new Error(`Maximum send amount of raw units (maximum is ${RAW_MAX_SEND_AMOUNT} raw units) exceeded. Send cancelled.`)
    }

    NANO_PRIVATE_KEY_SCHEMA.parse(process.env.NANO_PRIVATE_KEY)

    try {      
      let processJson = await raw_send({
        destinationAccount: parameters.destination_account,
        amountInRaw: parameters.amount
      })        

      return createTextResponse(JSON.stringify(processJson))      
    }
    catch (error) {
      console.error('[raw_send] Error:', error.message || error);
      return createErrorResponse(error)
    }
  }
)

// -----
// nano_send

const nano_send_parameters = {
  destination_account: z.string({
      required_error: `Destination account is required`,
    })
    .refine(account_ => N.checkAddress(account_), { message: 'Destination account is not valid' })
    .describe('Nano account to send the nano to'),
  amount: z.string({
      required_error: `Amount is required`,
    })
    .refine(amount_ => BALANCE_NANO.safeParse(amount_).success, { message: 'Amount must be in nano units, which is denoted as a decimal number, example 0.001, 1.000' })
    .transform(amount_ => BigNumber(amount_))
    .describe(`Amount of nano units to send (max ${(NANO_MAX_SEND_AMOUNT)} by default). Nano units only, not raw units.`)
}

server.registerTool(
  'nano_send',
  {
    description: 'Send a specified amount of nano units from a predefined Nano account to a destination Nano account.',
    inputSchema: nano_send_parameters
  },  
  async function (parameters) {
    
    NANO_PRIVATE_KEY_SCHEMA.parse(process.env.NANO_PRIVATE_KEY)

    if (parameters.amount.gt(NANO_MAX_SEND_AMOUNT)) {
      throw new Error(`Maximum send amount of nano units (maximum is ${NANO_MAX_SEND_AMOUNT} nano units) exceeded. Send cancelled.`)
    }    

    try {      
      let amountInRaw = convertNanoToRaw(parameters.amount)

      let processJson = await raw_send({
        destinationAccount: parameters.destination_account,
        amountInRaw
      })        

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
  account: z.string({ required_error: 'Account is required' })
    .refine(account_ => N.checkAddress(account_), { message: 'Nano account is not valid' })
    .describe("Nano account to get information about")
}

server.registerTool(
  'nano_account_info',
  {
    description: 'Retrieve detailed information about a specific Nano account, including balance (in nano and raw units), representative, and frontier block.',
    inputSchema: nano_account_info_parameters
  },  
  async function (parameters) {  
    try {
      let accountInfo =  await getAccountInfo(parameters.account)

      return createTextResponse(`The account information for ${parameters.account} is ` + JSON.stringify({ ...accountInfo, balance: friendlyAmount(accountInfo.balance) }))
    }
    catch (error) {
      console.error('[nano_account_info] Error:', error.message || error);
      return createErrorResponse(error)
    }    
  }
)

// -----
// nano_my_account_info

server.registerTool(
  'nano_my_account_info',
  {
    description: 'Retrieve detailed information about my Nano account, including balance (in nano and raw units), representative, and frontier block. This is the account that is used to send Nano from.',
  },  
  async function () {  
    try {
      NANO_PRIVATE_KEY_SCHEMA.parse(process.env.NANO_PRIVATE_KEY)

      const myAccount = getAccount()
      let myAccountInfo =  await getAccountInfo(myAccount)

      return createTextResponse(`The account information for ${myAccount} is ` + JSON.stringify({ ...myAccountInfo, balance: friendlyAmount(myAccountInfo.balance) }))
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

server.registerTool(
  'block_info',
  {
    description: 'Retrieve detailed information about a specific Nano block.',
    inputSchema: block_info_parameters
  },  
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
// x402_payment_signature_header

const x402_payment_signature_exact_scheme_create_parameters = {
  x402_payment_required_header: z.string({
      required_error: `PAYMENT-REQUIRED header is required`,
    })
    .describe(`PAYMENT-REQUIRED header returned by a x402 Resource Server.`)
}

server.registerTool(
  'x402_payment_signature_exact_scheme_create',
  {
    description: 'Create the PAYMENT-SIGNATURE header for Nano exact scheme x402 transaction.',
    inputSchema: x402_payment_signature_exact_scheme_create_parameters
  },  
  async function (parameters) {

    const SCHEME_EXACT = 'exact'
    const X402_NANO_NETWORK = process.env.X402_NANO_NETWORK || 'nano:mainnet'

    try {      
      const client = new x402Client()

      const helper = new Helper({
        NANO_ACCOUNT_PRIVATE_KEY: process.env.NANO_PRIVATE_KEY,
        NANO_RPC_URL: process.env.NANO_RPC_URL,  
        NANO_WORK_GENERATION_URL: process.env.NANO_WORK_GENERATION_URL
      })

      const exactNanoScheme = new ExactNanoScheme(helper)  
      client.register(X402_NANO_NETWORK, exactNanoScheme)
      const httpClient = new x402HTTPClient(client)      

      const getHeaderFromInitialResponse = (_) => parameters.x402_payment_required_header

      const paymentRequiredResponse = await httpClient.getPaymentRequiredResponse(getHeaderFromInitialResponse)

      if (!SUPPORTED_X402_VERSIONS.includes(paymentRequiredResponse?.x402Version)) {
        throw new Error(`Unsupported x402 protocol version (detected version ${paymentRequiredResponse?.x402Version}). x402 PAYMENT-SIGNATURE header creation cancelled.`)
      }

      let exactSchemeIsAccepted
      for (let i = 0; i <= paymentRequiredResponse?.accepts?.length; i++) {
        if (paymentRequiredResponse.accepts[i]?.scheme === SCHEME_EXACT && paymentRequiredResponse.accepts[i]?.network === X402_NANO_NETWORK) {
          exactSchemeIsAccepted = true
          break
        }
      }

      if (!exactSchemeIsAccepted) {
        throw new Error(`Scheme "${SCHEME_EXACT}" on network "${X402_NANO_NETWORK}" not supported by x402 Resource Server. x402 PAYMENT-SIGNATURE header creation cancelled.`)
      }

      const paymentSignatureHeader = await httpClient.createPaymentPayload(paymentRequiredResponse)

      if (BigNumber(paymentSignatureHeader?.accepted?.amount).gt(RAW_MAX_SEND_AMOUNT)) {
        throw new Error('Maximum send amount exceeded. x402 PAYMENT-SIGNATURE header creation cancelled.')
      }
      
      const paymentSignatureHeaderEncoded = httpClient.encodePaymentSignatureHeader(paymentSignatureHeader)

      return createTextResponse(JSON.stringify(paymentSignatureHeaderEncoded))
    }
    catch (error) {
      console.error('[x402_payment_signature_header] Error:', error.message || error);
      return createErrorResponse(error)
    }
  }
)

// -----
  
async function main() {
  if (process.env.NANO_MAX_SEND_AMOUNT && process.env.RAW_MAX_SEND_AMOUNT) {
    throw new Error('Both NANO_MAX_SEND_AMOUNT_DEFAULT and RAW_MAX_SEND_AMOUNT_DEFAULT are set. Please set just one to avoid conflicts.')
  }

  if (!BALANCE_NANO.safeParse(NANO_MAX_SEND_AMOUNT).success) {
    throw new Error('NANO_MAX_SEND_AMOUNT must be a decimal number, example 0.001, 1.000')
  }

  if (!BALANCE_RAW.safeParse(RAW_MAX_SEND_AMOUNT).success) {
    throw new Error('RAW_MAX_SEND_AMOUNT must be an integer, example 10000000000000000000000000000')
  }  

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`${SERVER_NAME} MCP Server running on stdio`)
}

main().catch((error) => {
  console.error(`[startup] ${SERVER_NAME} MCP Server Error:`, error.message || error)
  process.exit(1)
});