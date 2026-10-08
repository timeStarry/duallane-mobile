import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { Download } from 'lucide-react-native';
import { FileRow } from '../src/ui/files';

const file={id:'f1',fileName:'synthetic-report.txt',mimeType:'text/plain',byteSize:1024,status:'available',capabilities:{canDownload:true}};

test('a file row keeps name, size, and availability next to a compact accessible download icon',()=>{
  const download=jest.fn();
  const view=render(<FileRow file={file} download={download}/>);
  expect(view.getByText(file.fileName).props.numberOfLines).toBe(2);
  expect(view.getByText('1 KB · 可下载')).toBeTruthy();
  expect(view.queryByText('保存到设备')).toBeNull();
  const row=view.UNSAFE_getAllByType(View)[0]!;
  expect(StyleSheet.flatten(row.props.style)).toMatchObject({flexDirection:'row',alignItems:'center'});
  const button=view.getByRole('button',{name:`保存文件${file.fileName}到设备`});
  expect(button.findAllByType(Download)).toHaveLength(1);
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({minWidth:48,minHeight:48});
  fireEvent.press(button);
  expect(download).toHaveBeenCalledTimes(1);
});

test.each([
  [{...file,capabilities:{canDownload:false}},'暂不可下载'],
  [{...file,status:'unavailable'},'暂不可用'],
] as const)('unavailable file state %j preserves metadata and disables the download icon',(unavailable,status)=>{
  const download=jest.fn();
  const view=render(<FileRow file={unavailable} download={download}/>);
  expect(view.getByText(`1 KB · ${status}`)).toBeTruthy();
  const button=view.getByRole('button',{name:`保存文件${file.fileName}到设备`});
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(download).not.toHaveBeenCalled();
});
