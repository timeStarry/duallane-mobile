import { echoKindLabel, echoReleaseView } from '../src/domain/echo-release';

test('echo release cards expose version summary and usage locations, not only the title', () => {
  const view = echoReleaseView({
    version: '0.15.1',
    releasedAt: '2026-08-20',
    title: '更灵活的表情合集',
    summary: '表情合集现在可以订阅更新。',
    sections: [{
      title: '表情合集订阅',
      items: [{
        title: '管理订阅',
        description: '可以关闭订阅并保留当前快照。',
        location: '个人设置 -> 我的表情 -> 合集详情',
      }],
    }],
  }, '版本更新');
  expect(view.version).toBe('0.15.1');
  expect(view.title).toBe('更灵活的表情合集');
  expect(view.summary).toBe('表情合集现在可以订阅更新。');
  expect(view.releasedAt).toBe('2026年8月20日');
  expect(view.sections[0]?.items[0]?.location).toBe('个人设置 -> 我的表情 -> 合集详情');
  expect(echoKindLabel('echo.release')).toBe('版本更新');
});
