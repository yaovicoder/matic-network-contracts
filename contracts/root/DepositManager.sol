pragma solidity ^0.4.24;

import { ERC20 } from "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { Common } from "../lib/Common.sol";

import { RootChainable } from "../mixin/RootChainable.sol";
import { WETH } from "../token/WETH.sol";
import { TokenManager } from "./TokenManager.sol";
import { IManager } from "./IManager.sol";


contract DepositManager is IManager, TokenManager, RootChainable {
  using SafeMath for uint256;

  // deposit block
  struct DepositBlock {
    uint256 header;
    address owner;
    address token;
    uint256 amount;
    uint256 createdAt;
  }

  // list of deposits
  mapping(uint256 => DepositBlock) public deposits;

  // current deposit count
  uint256 public depositCount;

  //
  // Events
  //

  event Deposit(address indexed _user, address indexed _token, uint256 _amount, uint256 _depositCount);

  //
  // Constructor
  //

  constructor() {
    // reset deposit count
    depositCount = 1;
  }

  //
  // Public functions
  //

  // set Exit NFT contract
  function setExitNFTContract(address _nftContract) public onlyRootChain {}

  // set WETH token
  function setWETHToken(address _token) public onlyRootChain {
    wethToken = _token;
  }

  // map child token to root token
  function mapToken(address _rootToken, address _childToken) public onlyRootChain {
    _mapToken(_rootToken, _childToken);
  }

  // finalize commit when new header block commited
  function finalizeCommit(uint256 _currentHeaderBlock) public onlyRootChain {
    depositCount = 1;
  }

  // Get next deposit block
  function nextDepositBlock(uint256 currentHeaderBlock) public view returns (uint256) {
    return currentHeaderBlock.sub(CHILD_BLOCK_INTERVAL).add(depositCount);
  }

  function depositBlock(uint256 _depositCount) public view returns (
    uint256 _header,
    address _owner,
    address _token,
    uint256 _amount,
    uint256 _createdAt
  ) {
    DepositBlock memory _depositBlock = deposits[_depositCount];

    _header = _depositBlock.header;
    _owner = _depositBlock.owner;
    _token = _depositBlock.token;
    _amount = _depositBlock.amount;
    _createdAt = _depositBlock.createdAt;
  }

  // create deposit block and
  function createDepositBlock(
    uint256 _currentHeaderBlock,
    address _token,
    address _user,
    uint256 _amount
  ) public onlyRootChain {
    // throw if user is contract
    require(Common.isContract(_user) == false);

    // throw if amount is zero
    require(_amount > 0);

    // throws if token is not mapped
    require(_isTokenMapped(_token));

    // Only allow up to CHILD_BLOCK_INTERVAL deposits per header block.
    require(depositCount < CHILD_BLOCK_INTERVAL);

    // get deposit id
    uint256 _depositId = nextDepositBlock(_currentHeaderBlock);

    // broadcast deposit event
    emit Deposit(_user, _token, _amount, _depositId);

    // add deposit into deposits
    // DepositBlock memory _depositBlock 
    deposits[_depositId] = DepositBlock({
      header: _currentHeaderBlock,
      owner: _user,
      token: _token,
      amount: _amount,
      createdAt: block.timestamp
    });

    // deposits[_depositId] = _depositBlock;

    // increase deposit counter
    depositCount = depositCount.add(1);
  }
}
