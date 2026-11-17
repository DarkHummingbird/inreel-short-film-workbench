import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clone, fixture } from '../src/common.ts'
import { createProject, openStore } from '../src/store.ts'
import { apply, put } from '../src/workflow.ts'
import { previewJob, queue, worker } from '../src/jobs.ts'
import { renderSceneLayout } from '../src/media.ts'
import { composeSkillPrompt, productionSkill } from '../src/production-skills.ts'
import { existsSync } from 'node:fs'

test('场景、道具和场景新视角生成使用当前分镜与已绑定场景', () => {
  const p = createProject('素材生成', 'op_lin'), actor = 'dir_zhou'
  const brief = put(p, actor, 'brief', { ...clone(fixture.brief), raw:'咖啡馆', planned_shot_count:5 }, null)
  p.current.brief = brief.ref
  const script = put(p, actor, 'script', clone(fixture.script), null)
  p.active['2'] = 'check2@v1'
  p.confirmations['check2@v1'] = { ref:'check2@v1', artifact_ref:script.ref }
  const shots=clone(fixture.shots), shot=shots[0]
  p.assets['scene@v1'] = { kind:'image', reference_kind:'location' }
  p.assets['prop@v1'] = { kind:'image', reference_kind:'prop' }
  const board=apply(p,actor,'artifact',{type:'storyboard',data:{shots,total_duration_ms:shots.reduce((n,s)=>n+s.duration_ms,0),references:{},keyframes:{},production:{[shot.shot_id]:{location:'scene@v1'}}}})
  const scene=queue(p,actor,{task:'location_reference',shot_id:shot.shot_id})
  const storyboardJob=queue(p,actor,{task:'storyboard'})
  const storyboardPreview=previewJob(p,actor,{task:'storyboard'})
  assert.equal(storyboardJob.skill.mode,'prompt_injection')
  assert.equal(storyboardJob.skill.injected_to_model,true)
  assert.equal(storyboardJob.skill.id,'video-storyboard-adapted')
  assert.match(storyboardJob.skill.source,/video-storyboard\/SKILL\.md/)
  assert.match(storyboardJob.skill.instruction,/相邻镜头/)
  assert.match(storyboardJob.skill.instruction,/不要创建或声称已生成/)
  assert.deepEqual(storyboardJob.skill.not_executed,['scene-XX.png 图片表格','scene-XX.md 文件导出','九宫格图片生成'])
  assert.match(composeSkillPrompt(storyboardJob.skill),/本次任务工作方法（video-storyboard-adapted@1\.2\.0）/)
  assert.match(storyboardPreview.note,/只显示将使用的素材/)
  assert.match(storyboardPreview.agent_prompt,/video-storyboard-adapted/)
  assert.equal(storyboardJob.agent_prompt, storyboardPreview.agent_prompt)
  assert.equal(scene.plan.input.mode,'location')
  assert.deepEqual(scene.plan.production.references,{})
  assert.throws(()=>queue(p,actor,{task:'prop_reference',shot_id:shot.shot_id}),/描述要生成的道具/)
  const prop=queue(p,actor,{task:'prop_reference',shot_id:shot.shot_id,task_request:'一只纸袋'})
  assert.equal(prop.plan.input.mode,'prop')
  const view=queue(p,actor,{task:'location_view',shot_id:shot.shot_id,task_request:'反打'})
  assert.equal(view.plan.input.mode,'location_view')
  assert.deepEqual(view.plan.production.references,{location:'scene@v1'})
  const layout=queue(p,actor,{task:'blocking_plan',shot_id:shot.shot_id,task_request:'画出人物路线和机位'})
  assert.equal(layout.plan.input.mode,'location_view')
  assert.deepEqual(layout.plan.production.references,{location:'scene@v1'})
  const coordinates={confirmed:true,note:'画外区域按示意假设',objects:[{name:'柜台',x:4,y:5,w:4,h:1}],people:[{name:'乔宁',start_x:3,start_y:6,via_x:7,via_y:6,end_x:7,end_y:3,facing:'E'}],camera:{x:5,y:1,facing:'N'}}
  const floor=queue(p,actor,{task:'layout_render',shot_id:shot.shot_id,layout:coordinates})
  assert.equal(floor.skill.id,'scene-view-planner-and-director-blocking')
  assert.equal(floor.skill.mode,'renderer_only')
  assert.equal(floor.skill.injected_to_model,false)
  assert.deepEqual(floor.skill.executed_steps,['floorplan.py'])
  assert.equal(floor.plan.source_location,'scene@v1')
  assert.throws(()=>queue(p,actor,{task:'layout_render',shot_id:shot.shot_id,layout:{...coordinates,confirmed:false}}),/确认布局/)
  assert.throws(()=>queue(p,actor,{task:'layout_render',shot_id:shot.shot_id,layout:{...coordinates,people:[{name:'乔宁',start_x:3,start_y:6,end_x:7,end_y:3,facing:'E'}]}}),/穿过固定物/)
  assert.throws(()=>apply(p,actor,'shot.edit',{board_ref:board.ref,shot_id:shot.shot_id,changes:{location:'prop@v1'}}),/对应类型/)
  board.data.keyframes[shot.shot_id]='scene@v1'
  p.active['3']='check3@v1';p.confirmations['check3@v1']={ref:'check3@v1',artifact_ref:board.ref}
  const repaint=queue(p,actor,{task:'repaint',shot_id:shot.shot_id,task_request:'只修正前景多出来的一只手，其余保持不变'})
  assert.equal(repaint.plan.agent,'art')
  assert.equal(repaint.plan.production.edit_base,'scene@v1')
  assert.match(repaint.agent_prompt,/本次是局部重绘/)
  assert.match(repaint.agent_prompt,/不得改变的人物身份、手部数量、服装、构图、背景、道具和光线/)
  const multi=queue(p,actor,{task:'video',shot_id:shot.shot_id,video_mode:'references',reference_images:[{ref:'scene@v1',role:'场景'},{ref:'prop@v1',role:'道具'}]})
  const videoPreview=previewJob(p,actor,{task:'video',shot_id:shot.shot_id,video_mode:'references',reference_images:[{ref:'scene@v1',role:'场景'},{ref:'prop@v1',role:'道具'}]})
  assert.equal(multi.plan.video_mode,'references')
  assert.equal(multi.plan.video_references.length,2)
  assert.equal(multi.skill.id,'visual-video-adapted')
  assert.match(multi.skill.license,/CC BY 4\.0/)
  assert.match(multi.skill.instruction,/环境压力/)
  assert.match(multi.skill.instruction,/身体微动作/)
  assert.match(multi.skill.instruction,/结尾画面/)
  assert.match(multi.skill.instruction,/一个主要机位运动/)
  assert.match(composeSkillPrompt(multi.skill),/visual-video-adapted@1\.2\.0/)
  assert.equal(multi.agent_prompt, videoPreview.agent_prompt)
  assert.deepEqual(videoPreview.plan.video_references,[{ref:'scene@v1',role:'场景'},{ref:'prop@v1',role:'道具'}])
  assert.throws(()=>queue(p,actor,{task:'video',shot_id:shot.shot_id,video_mode:'references',reference_images:[{ref:'scene@v1',role:'场景'},{ref:'scene@v1',role:'重复'}]}),/不同参考图/)
})

test('分镜与镜头 Skill 用可执行改编规则注入并保留来源，质检 Agent 已移除', () => {
  const storyboard=productionSkill('storyboard')
  const vfx=productionSkill('vfx')
  const quality=productionSkill('quality')
  assert.ok(storyboard && vfx)
  assert.equal(quality, undefined)
  assert.equal(storyboard.mode,'prompt_injection')
  assert.equal(vfx.mode,'prompt_injection')
  assert.match(vfx.source,/dramaturgy\.md/)
  assert.match(vfx.source,/universal-rules\.md/)
  assert.match(vfx.instruction,/CC BY 4\.0/)
})

test('可先准备并修改生图提示词，再用修改后的计划生成图片', async () => {
  const store = openStore(':memory:')
  try {
    const p = createProject('可编辑生图提示词', 'op_lin'), actor='dir_zhou'
    const brief = put(p, actor, 'brief', { ...clone(fixture.brief), raw:'咖啡店', theme:'GL' }, null)
    p.current.brief = brief.ref
    const script = put(p, actor, 'script', clone(fixture.script), null)
    p.active['2']='check2@v1'; p.confirmations['check2@v1']={ref:'check2@v1',artifact_ref:script.ref}
    p.assets['scene@v1']={kind:'image'}
    const shots=clone(fixture.shots)
    const board=apply(p,actor,'artifact',{type:'storyboard',data:{shots,total_duration_ms:shots.reduce((sum,shot)=>sum+shot.duration_ms,0),references:{},keyframes:{[shots[0].shot_id]:'scene@v1'},production:{}}})
    p.active['3']='check3@v1'; p.confirmations['check3@v1']={ref:'check3@v1',artifact_ref:board.ref}
    store.save(p)
    const prepare=queue(p,actor,{task:'keyframe',shot_id:shots[0].shot_id,prompt_only:true})
    store.save(p)
    const bg=worker(store)
    await bg.start(p.id,prepare.id); await bg.idle()
    const preparedJob=store.get(p.id).jobs[prepare.id]
    assert.equal(preparedJob.state,'succeeded')
    assert.equal(preparedJob.plan.prompt_only,true)
    assert.equal(preparedJob.result.asset_ref,null)
    const edited=structuredClone(preparedJob.result.response)
    edited.result.image_prompt += ' 人工修改：纸袋提绳保持连续。'
    const next=store.get(p.id)
    const final=queue(next,actor,{task:'keyframe',shot_id:shots[0].shot_id,prepared_plan:edited})
    store.save(next)
    await bg.start(p.id,final.id); await bg.idle()
    const finalJob=store.get(p.id).jobs[final.id]
    assert.equal(finalJob.state,'succeeded')
    assert.equal(finalJob.saved_agent_plan.source,'edited')
    assert.match(finalJob.result.response.result.image_prompt,/人工修改/)
    assert.ok(finalJob.result.asset_ref)
    assert.equal(store.get(p.id).assets[finalJob.result.asset_ref].kind,'image')
  } finally { store.close() }
})

test('场景 Skill 根据确认的坐标绘制可复核的俯视图', {skip:!existsSync('.venv-scene/bin/python')}, async () => {
  const layout={confirmed:true,note:'墙外为假设',objects:[{name:'柜台',x:3.5,y:5,w:3,h:1}],people:[{name:'乔宁',start_x:3.5,start_y:6,via_x:6,via_y:6,end_x:6,end_y:3,facing:'E'}],camera:{x:5,y:1,facing:'N'}}
  const asset=await renderSceneLayout(layout)
  assert.equal(asset.source,'scene-view-planner')
  assert.equal(asset.reference_kind,'layout')
  assert.deepEqual(asset.layout_spec,layout)
  assert.ok(asset.width>240 && asset.height>240)
})
