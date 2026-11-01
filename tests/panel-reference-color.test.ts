import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';import {defaultSettings} from '../src/infrastructure/config/profile';

async function referencePanel(){
  const h=await panelHarness({settings:defaultSettings()});await h.wait();
  const original=h.ps.app.activeDocument,docs=[original];let active=original,cancelPicker=false;
  Object.defineProperty(h.ps.app,'documents',{get:()=>docs});Object.defineProperty(h.ps.app,'activeDocument',{get:()=>active,set:doc=>{active=doc;}});
  const file={name:'reference.jpg',nativePath:'C:/fixture/reference.jpg',isFile:true,getMetadata:async()=>({size:3}),read:async()=>new Uint8Array([255,216,255]).buffer};
  (h.uxp.storage.localFileSystem as any).getFileForOpening=async()=>cancelPicker?undefined:file;
  const ref:any={...original,id:20,path:file.nativePath,colorProfileName:'',layers:[{id:21}]};
  const close=(doc:any)=>async()=>{docs.splice(docs.indexOf(doc),1);};ref.closeWithoutSaving=close(ref);
  ref.duplicate=async()=>{const copy={...ref,id:22,path:undefined};copy.closeWithoutSaving=close(copy);docs.push(copy);active=copy;return copy;};
  h.ps.app.open=async()=>{docs.push(ref);active=ref;return ref;};
  const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=async(fn:any)=>{try{return await modal(fn);}catch(error){throw String(error);}};
  return {h,original,ref,docs,cancelPicker:()=>{cancelPicker=true;}};
}

test('reference opt-in is default-off and one-use; strict errors explain the reference without source recovery',async()=>{
  const {h,original,ref,docs}=await referencePanel();try{
    assert.ok(h.el('reference-assume-srgb'));assert.equal(!!h.el('reference-assume-srgb').checked,false);
    h.click('reference');await h.wait();const d=JSON.parse(h.el('diagnostic-details').value);
    assert.equal(d.code,'source-profile');assert.match(d.action,/参考图|参考图片/);assert.match(d.action,/sRGB/);assert.equal(h.el('diagnostic-primary').style.display,'none');assert.equal(h.uploads.length,0);
    h.el('reference-assume-srgb').checked=true;h.click('reference');await h.wait();
    assert.equal(h.el('reference-assume-srgb').checked,false);assert.equal(h.el('diagnostic-box').style.display,'none');assert.equal(h.el('reference-color-warning').style.display,'block');assert.match(h.el('reference-color-warning').textContent,/假定 sRGB/);
    assert.deepEqual(docs,[original]);assert.equal(ref.colorProfileName,'');assert.equal(h.ps.app.activeDocument,original);assert.equal(h.uploads.length,0);
    h.el('language').value='en-US';h.change('language');await h.wait();assert.match(h.el('reference-color-warning').textContent,/assumed sRGB/i);
    h.click('clear-reference');await h.wait();assert.equal(h.el('reference-color-warning').style.display,'none');
  }finally{await h.close();}
});

test('cancelled reference picker consumes the one-use opt-in without reading or uploading',async()=>{
  const {h,cancelPicker}=await referencePanel();try{assert.ok(h.el('reference-assume-srgb'));cancelPicker();h.el('reference-assume-srgb').checked=true;h.click('reference');await h.wait();assert.equal(h.el('reference-assume-srgb').checked,false);assert.equal(h.pixelRequests.length,0);assert.equal(h.uploads.length,0);}finally{await h.close();}
});

test('reference source changes offer reselect guidance without capturing the unrelated current document',async()=>{
  const {h,ref}=await referencePanel();try{
    const read=h.ps.imaging.getPixels;h.ps.imaging.getPixels=async(o:any)=>{const result=await read(o);ref.activeHistoryState={id:999};return result;};
    h.el('reference-assume-srgb').checked=true;h.click('reference');await h.wait();
    const report=JSON.parse(h.el('diagnostic-details').value);assert.equal(report.code,'source-changed');assert.match(report.action,/重新选择参考图/);
    assert.equal(h.el('diagnostic-primary').style.display,'none');const reads=h.pixelRequests.length;
    h.click('diagnostic-primary');await h.wait();assert.equal(h.pixelRequests.length,reads);assert.equal(h.uploads.length,0);
  }finally{await h.close();}
});

test('actual approximate reference use is saved and shown in results and reopened history without restoring consent',async()=>{
  const {h}=await referencePanel();let record:any;try{
    assert.ok(h.el('reference-assume-srgb'));h.el('reference-assume-srgb').checked=true;h.click('reference');await h.wait();
    h.click('tab-cosplay');h.el('mode').value='reference';h.change('mode');h.el('resolution').value='32';h.el('count').value='1';h.click('generate');await h.wait();
    record=h.records()[0];assert.ok(record);assert.equal(record.params.referenceColorReason,'assumed-srgb');assert.ok(h.uploads.some(u=>u.name.endsWith('-reference.png')));
    assert.match(h.el('candidate-color-warning').textContent,/参考图色彩.*假定 sRGB/);await h.refreshHistory();h.selectHistory(record.id);await h.wait();assert.match(h.el('history-details').textContent,/参考图色彩.*假定 sRGB/);
  }finally{await h.close();}
  const reopened=await panelHarness({settings:defaultSettings(),history:[record]});try{await reopened.wait();await reopened.refreshHistory();reopened.selectHistory(record.id);await reopened.wait();assert.match(reopened.el('history-details').textContent,/参考图色彩.*假定 sRGB/);reopened.click('repeat-history');await reopened.wait();assert.equal(!!reopened.el('reference-assume-srgb').checked,false);assert.equal(reopened.uploads.length,0);}finally{await reopened.close();}
});
