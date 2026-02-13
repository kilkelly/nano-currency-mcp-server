# Nano Currency MCP Server

`Nano Currency MCP Server` gives MCP-compatible clients (including AI agents) the ability to send Nano currency and retrieve account & block information via the Nano node RPC.

AI agents are increasingly adopting the MCP standard and this server gives them the ability to send Nano at their owner's request or possibly autonomously in some setups 🤖

`Nano Currency MCP Server` also allows for the creation of x402-compatible headers, giving AI agents the ability to pay for APIs/resources using Nano.

## ❔ What is MCP?

The Model Context Protocol (MCP) is an open framework that defines a standardized approach for applications to deliver context to Large Language Models (LLMs).

## ❔ What is Nano Currency?

Nano is a digital currency designed to enable fast, scalable, and feeless transactions. It aims to address common issues in traditional cryptocurrencies, such as high fees and slow processing times, making it an efficient option for everyday peer-to-peer payments. Learn more at [nano.org](https://nano.org)

## ❔ What is x402?

x402 is an internet-native payment protocol that revives the unused HTTP 402 Payment Required status code to enable instant, programmatic, and permissionless payments over the web. Learn more at [x402.org](https://x402.org). Nano-specific x402 schemes and implementation code can be found at the [x402nano GitHub resource](https://github.com/x402nano).

## 🚨 Before Proceeding 🚨

Caution: LLMs can hallucinate and not always perform as you want, so test this server with small amounts of Nano. Use either the `RAW_MAX_SEND_AMOUNT` or `NANO_MAX_SEND_AMOUNT` environment variables described later to restrict the maximum amount of Nano that can be sent at a time.

## 🛠️ Tools Provided by Nano Currency MCP Server

🔧 `raw_send` - Send a specified amount of raw units from a predefined Nano account to a destination Nano account.

🔧 `nano_send` - Send a specified amount of nano units from a predefined Nano account to a destination Nano account.

🔧 `nano_account_info` - Retrieve detailed information about a specific Nano account, including balance (in both nano and raw units), representative, and frontier block.

🔧 `nano_my_account_info` - Retrieve detailed information about my Nano account, including balance (in both nano and raw units), representative, and frontier block. This is the account that is used to send Nano from.

🔧 `block_info` - Retrieve detailed information about a specific Nano block.

🔧 `x402_payment_signature_exact_scheme_create` - Create the PAYMENT-SIGNATURE header for a Nano x402 transaction conforming to the [exact](https://github.com/x402nano/schemes/blob/main/exact.md) scheme.

## 🔌 Installation

Make sure you have [Node.js](https://nodejs.org/) with NPM installed on your system. 

```
git clone https://github.com/kilkelly/nano-currency-mcp-server.git
cd nano-currency-mcp-server
npm install
```

You will need an MCP client to connect to `Nano Currency MCP Server`. Each client will have its own way to connect to MCP servers. For your chosen client you will have to find out how environment variables for a MCP server are set. When you know how you will need to set the following environment variables to use the `Nano Currency MCP Server`.

## ⚙️ Environment Variables

`NANO_RPC_URL` (**required**) - URL which should be used to communicate with a Nano node RPC. This can be a local or remotely hosted endpoint.

`NANO_WORK_GENERATION_URL` - URL which should be used to communicate with an endpoint that supports the [work_generate](https://docs.nano.org/commands/rpc-protocol/#work_generate) RPC command for work generation. If not specified, defaults to `NANO_RPC_URL`. Used by tools 🔧 `nano_send` 🔧 `raw_send` 🔧 `x402_payment_signature_exact_scheme_create`

`NANO_PRIVATE_KEY` - Nano private key which will be used to sign send transactions and to derive the Nano account from. Caution: 🚨*NOT THE WALLET SEED*🚨. Test with the private key of an account with a small Nano balance. Used by tools 🔧 `nano_send` 🔧 `raw_send` 🔧 `nano_my_account_info` 🔧 `x402_payment_signature_exact_scheme_create`

`RAW_MAX_SEND_AMOUNT` - Maximum amount (in raw units) which can be sent in a single transaction. For safety purposes the default maximum send amount is 10000000000000000000000000000 raw (Ӿ0.01). You must set this variable explicitly to grant the power to send higher amounts. Used by tools 🔧 `raw_send` 🔧 `x402_payment_signature_exact_scheme_create`

`NANO_MAX_SEND_AMOUNT` - Maximum amount (in nano units) which can be sent in a single transaction. For safety purposes the default maximum send amount is 0.01 nano (Ӿ0.01). You must set this variable explicitly to grant the power to send higher amounts. Used by tools 🔧 `nano_send` 🔧 `x402_payment_signature_exact_scheme_create`

`X402_NANO_NETWORK` - The Nano network that an x402 Nano transaction is being created for. The default network is "nano:mainnet". Used by tools 🔧 `x402_payment_signature_exact_scheme_create`

## Setup Example

The following is an example of a setup for `Nano Currency MCP Server` in Claude Desktop.

```
{
  "mcpServers": {
    "nano_currency": {
      "command": "ENTER FULL FILE PATH TO node.exe ON YOUR SYSTEM",
      "args": [
        "ENTER FULL FILE PATH TO nano-currency.js FILE FROM THIS REPOSITORY"
      ],
      "env": {
        "NANO_RPC_URL": "ENTER YOUR NANO_RPC_URL",
        "NANO_WORK_GENERATION_URL": "ENTER YOUR NANO_WORK_GENERATION_URL",
        "NANO_PRIVATE_KEY": "ENTER YOUR NANO_PRIVATE_KEY",
        "RAW_MAX_SEND_AMOUNT": "ENTER A RAW_MAX_SEND_AMOUNT (in raw units, example 10000000000000000000000000000)",
        "NANO_MAX_SEND_AMOUNT": "ENTER A NANO_MAX_SEND_AMOUNT (in nano units, example 0.001, 1.000)",
        "X402_NANO_NETWORK": "ENTER YOUR X402_NANO_NETWORK"
      }      
    }    
  }
}
```

## 🚨 Disclaimer 🚨
As always when working with real world value, in this case Nano, **be careful** when using this software. The authors and contributors shall not be held liable for any use of this software's functionality, intentional or unintentional, that leads to an undesired loss of funds.

## 📄 License
MIT