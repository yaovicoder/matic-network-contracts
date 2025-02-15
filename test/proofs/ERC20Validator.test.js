/* global artifacts, web3, assert, contract */

import utils from 'ethereumjs-util'
import { Buffer } from 'safe-buffer'

import {
  getTxBytes,
  getTxProof,
  verifyTxProof,
  getReceiptBytes,
  getReceiptProof,
  verifyReceiptProof
} from '../helpers/proofs.js'
import { getHeaders, getBlockHeader } from '../helpers/blocks.js'
import MerkleTree from '../helpers/merkle-tree.js'
import { linkLibs } from '../helpers/utils.js'
import LogDecoder from '../helpers/log-decoder.js'

import {
  RootToken,
  WithdrawManagerMock,
  ERC20ValidatorMock,
  DepositManagerMock,
  RootChainMock
} from '../helpers/contracts.js'

let ChildChain = artifacts.require('../child/ChildChain.sol')
let ChildToken = artifacts.require('../child/ChildERC20.sol')

const web3Child = new web3.constructor(
  new web3.providers.HttpProvider('http://localhost:8546')
)

ChildChain.web3 = web3Child
ChildToken.web3 = web3Child

const rlp = utils.rlp

contract('ERC20Validator', async function(accounts) {
  describe('initialization', async function() {
    let logDecoder
    let rootToken
    let childToken
    let rootChain
    let childChain
    let withdrawManager
    let user
    let depositManager
    let owner = accounts[0]

    before(async function() {
      // link libs
      await linkLibs(web3Child)

      logDecoder = new LogDecoder([
        RootToken._json.abi,
        ERC20ValidatorMock._json.abi,
        WithdrawManagerMock._json.abi,
        RootChainMock._json.abi,
        DepositManagerMock._json.abi
      ])

      user = accounts[0]

      rootToken = await RootToken.new('Test Token', 'TEST', { from: user })
      childChain = await ChildChain.new({ from: user, gas: 6000000 })

      let childTokenReceipt = await childChain.addToken(rootToken.address, 18, {
        from: user
      })
      childToken = ChildToken.at(childTokenReceipt.logs[0].args.token)

      rootChain = await RootChainMock.new(rootToken.address) // dummy address for stakemanager
      depositManager = await DepositManagerMock.new({ from: owner })
      withdrawManager = await WithdrawManagerMock.new({ from: owner })

      await depositManager.changeRootChain(rootChain.address, { from: owner })
      await withdrawManager.changeRootChain(rootChain.address, {
        from: owner
      })

      await rootChain.setDepositManager(depositManager.address, {
        from: owner
      })
      await rootChain.setWithdrawManager(withdrawManager.address, {
        from: owner
      })

      await withdrawManager.setDepositManager(depositManager.address)

      // map token
      await rootChain.mapToken(rootToken.address, childToken.address, {
        from: owner
      })
    })

    it('should deposit token', async function() {
      const amount = web3.toWei(10)

      // deposit amount
      await rootToken.approve(rootChain.address, amount, {
        from: user
      })

      let depositReceipt = await rootChain.deposit(
        rootToken.address,
        user,
        amount,
        {
          from: user
        }
      )

      const depositLogs = logDecoder.decodeLogs(depositReceipt.receipt.logs)
      const depositCount = depositLogs[1].args._depositCount.toString()
      await childChain.depositTokens(
        rootToken.address,
        user,
        amount,
        depositCount,
        {
          from: user
        }
      )
    })

    it('should transfer tokens', async function() {
      const amount = web3.toWei(1)

      // transfer receipt
      let obj = await childToken.transfer(user, amount, {
        from: user
      })

      // receipt
      let receipt = obj.receipt
      let transfer = await web3Child.eth.getTransaction(receipt.transactionHash)
      let transferBlock = await web3Child.eth.getBlock(receipt.blockHash, true)
      let transferReceipt = await web3Child.eth.getTransactionReceipt(
        receipt.transactionHash
      )

      const start = transfer.blockNumber - 1
      const end = transfer.blockNumber
      const headers = await getHeaders(start, end, web3Child)
      const tree = new MerkleTree(headers)
      const v = getBlockHeader(transferBlock)

      // check if verify works or not
      assert.isOk(
        tree.verify(
          v,
          transferBlock.number - start,
          tree.getRoot(),
          tree.getProof(v)
        )
      )

      const headerNumber = 0
      const root = utils.bufferToHex(tree.getRoot())
      // set header block
      await rootChain.setHeaderBlock(
        headerNumber,
        root,
        start,
        end,
        transferBlock.timestamp
      )

      // validate tx proof
      // transaction proof
      const txProof = await getTxProof(transfer, transferBlock)
      // check if proof is valid
      assert.isOk(verifyTxProof(txProof), 'Tx proof must be valid')

      // validate receipt proof
      const receiptProof = await getReceiptProof(
        transferReceipt,
        transferBlock,
        web3Child
      )
      assert.isOk(
        verifyReceiptProof(receiptProof),
        'Receipt proof must be valid'
      )

      // validate header proof
      const headerProof = await tree.getProof(getBlockHeader(transferBlock))

      // create  erc20 validator
      const erc20Validator = await ERC20ValidatorMock.new()
      await erc20Validator.changeRootChain(rootChain.address)
      await erc20Validator.setDepositManager(depositManager.address)

      // ERC20 validator
      receipt = await erc20Validator.validateERC20Tx(
        utils.bufferToHex(
          rlp.encode([
            headerNumber, // header block
            utils.bufferToHex(Buffer.concat(headerProof)), // header proof

            transferBlock.number, // block number
            transferBlock.timestamp, // block timestamp
            utils.bufferToHex(transferBlock.transactionsRoot), // tx root
            utils.bufferToHex(transferBlock.receiptsRoot), // tx root
            utils.bufferToHex(rlp.encode(receiptProof.path)), // key for trie (both tx and receipt)

            utils.bufferToHex(getTxBytes(transfer)), // tx bytes
            utils.bufferToHex(rlp.encode(txProof.parentNodes)), // tx proof nodes

            utils.bufferToHex(getReceiptBytes(transferReceipt)), // receipt bytes
            utils.bufferToHex(rlp.encode(receiptProof.parentNodes)) // reciept proof nodes
          ])
        )
      )
    })
  })
})
