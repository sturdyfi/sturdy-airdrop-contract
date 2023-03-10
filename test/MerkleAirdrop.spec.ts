import { deployments, ethers, getNamedAccounts, getUnnamedAccounts } from 'hardhat';
import { makeSuite } from './helpers/make-suite';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import fs from 'fs';
import path from 'path';
import { parseEther } from 'ethers/lib/utils';

const chai = require('chai');
const { expect } = chai;

makeSuite('MerkleAirdrop', () => {
  const TRANSFER_ROLE = 0;

  let merkleTree;
  let Airdrop;
  const user1amount = ethers.utils.parseUnits('1385', 18);
  const user2amount = ethers.utils.parseUnits('2178.75', 18);
  const totalAmount = ethers.utils.parseUnits('3653.75', 18);

  before('Setup', async () => {
    const { execute } = deployments;
    const { deployer, user1, user2 } = await getNamedAccounts();
    const [deployerSigner] = await ethers.getSigners();

    await deployerSigner.sendTransaction({ value: parseEther('1000'), to: user1 });
    await deployerSigner.sendTransaction({ value: parseEther('1000'), to: user2 });
    
    Airdrop = (await deployments.get('MerkleAirdrop')).address;

    await execute(
      'STRDY',
      { from: deployer },
      'transfer',
      Airdrop,
      totalAmount
    );
    await execute(
      'STRDY',
      { from: deployer },
      'setRoleCapability',
      TRANSFER_ROLE,
      '0xa9059cbb',
      true
    );
    await execute('STRDY', { from: deployer }, 'setUserRole', Airdrop, TRANSFER_ROLE, true);

    // Setup merkle tree
    merkleTree = StandardMerkleTree.load(
      JSON.parse(fs.readFileSync(path.join(__dirname, '../merkle.json')).toString())
    );
  });

  it('Check users pre-claim status', async () => {
    const { read } = deployments;
    const { user1, user2 } = await getNamedAccounts();

    expect(await read('STRDY', 'balanceOf', user1)).to.be.eq(0);
    expect(await read('STRDY', 'balanceOf', user2)).to.be.eq(0);
    expect(await read('STRDY', 'balanceOf', Airdrop)).to.be.eq(totalAmount);

    expect(await read('MerkleAirdrop', 'claimed', user1)).to.be.eq(false);
    expect(await read('MerkleAirdrop', 'claimed', user2)).to.be.eq(false);

    const user1proof = merkleTree.getProof([user1, user1amount]);
    expect(await read('MerkleAirdrop', 'verifyClaim', user1, user1amount, user1proof)).to.be.eq(
      true
    );

    const user2proof = merkleTree.getProof([user2, user2amount]);
    expect(await read('MerkleAirdrop', 'verifyClaim', user2, user2amount, user2proof)).to.be.eq(
      true
    );

    expect(
      await read(
        'MerkleAirdrop',
        'verifyClaim',
        user1,
        ethers.utils.parseUnits('1386', 18),
        user1proof
      )
    ).to.be.eq(false);
    expect(
      await read(
        'MerkleAirdrop',
        'verifyClaim',
        user2,
        ethers.utils.parseUnits('2178.76', 18),
        user2proof
      )
    ).to.be.eq(false);
    expect(await read('MerkleAirdrop', 'verifyClaim', user2, user1amount, user1proof)).to.be.eq(
      false
    );
    expect(await read('MerkleAirdrop', 'verifyClaim', user1, user2amount, user2proof)).to.be.eq(
      false
    );
  });

  it('Check users claim', async () => {
    const { read, execute } = deployments;
    const { user1, user2 } = await getNamedAccounts();
    const user1proof = merkleTree.getProof([user1, user1amount]);
    const user2proof = merkleTree.getProof([user2, user2amount]);

    // fail: wrong amount case
    await expect(
      execute(
        'MerkleAirdrop',
        { from: user1 },
        'claim',
        user1,
        ethers.utils.parseUnits('2178.76', 18),
        user1proof
      )
    ).to.be.reverted;

    // fail: wrong user case
    await expect(execute('MerkleAirdrop', { from: user2 }, 'claim', user2, user1amount, user1proof))
      .to.be.reverted;

    // success: directly claim
    await expect(execute('MerkleAirdrop', { from: user1 }, 'claim', user1, user1amount, user1proof))
      .to.be.not.reverted;

    // success: indirectly claim
    await expect(execute('MerkleAirdrop', { from: user1 }, 'claim', user2, user2amount, user2proof))
      .to.be.not.reverted;

    // after-claim check state
    expect(await read('MerkleAirdrop', 'claimed', user1)).to.be.eq(true);
    expect(await read('MerkleAirdrop', 'claimed', user2)).to.be.eq(true);
    expect(await read('STRDY', 'balanceOf', user1)).to.be.eq(ethers.utils.parseUnits('1385', 18));
    expect(await read('STRDY', 'balanceOf', user2)).to.be.eq(ethers.utils.parseUnits('2178.75', 18));
    expect(await read('STRDY', 'balanceOf', Airdrop)).to.be.eq(ethers.utils.parseUnits('90', 18));

    // fail: double claim
    await expect(execute('MerkleAirdrop', { from: user1 }, 'claim', user1, user1amount, user1proof))
      .to.be.reverted;
  });

  it('Check admin withdraw', async () => {
    const { read, execute } = deployments;
    const { deployer, user1 } = await getNamedAccounts();
    const [,,, owner] = await getUnnamedAccounts();
    // transfer ownership to owner
    await execute('MerkleAirdrop', { from: deployer }, 'transferOwnership', owner);

    // fail: only owner can withdraw
    await expect(
      execute(
        'MerkleAirdrop',
        { from: user1 },
        'withdraw',
        user1,
        ethers.utils.parseUnits('80', 18)
      )
    ).to.be.reverted;

    // success: withdraw amount
    await expect(execute('MerkleAirdrop', { from: owner }, 'withdraw', owner, ethers.utils.parseUnits('30', 18)))
      .to.be.not.reverted;

    // success: withdraw full amount
    await expect(execute('MerkleAirdrop', { from: owner }, 'withdraw', owner, 0))
      .to.be.not.reverted;

    // after-withdraw check state
    expect(await read('STRDY', 'balanceOf', owner)).to.be.eq(ethers.utils.parseUnits('90', 18));
    expect(await read('STRDY', 'balanceOf', Airdrop)).to.be.eq('0');
  });
});
