import { ProfitCenter } from './profit-center';
import * as assert from 'power-assert';

const profitCenter = new ProfitCenter();

const testGetLastPrice = async () => {
  const res = await profitCenter.getLastAveragePrice('xrp_jpy');
  console.log(res);
}

describe('利润控制中心测试', () => {
  it('测试获取最新价格', testGetLastPrice);
});
