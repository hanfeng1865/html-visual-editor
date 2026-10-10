import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGenerationSkills} from '../generation-skills.mjs';
test('generation skills persist edits, preserve previous versions and reject stale writes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'generation-skills-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const skills=createGenerationSkills(dir),initial=await skills.get('requirements');
 assert.match(initial.content,/name: requirements/);assert.equal(initial.source,'default');
 const content=initial.content+'\n新增规则：验收按用户任务编写。\n';
 const saved=await skills.save({id:'requirements',revision:initial.revision,content});
 assert.equal(saved.source,'custom');assert.equal(saved.history[0].content,initial.content);
 assert.equal((await createGenerationSkills(dir).get('requirements')).content,content);
 await assert.rejects(skills.save({id:'requirements',revision:initial.revision,content}),{statusCode:409});
 const loaded=await skills.load('requirements');assert.match(loaded.instruction,/新增规则/);assert.equal(loaded.skill.revision,saved.revision);
 const restored=await skills.save({id:'requirements',revision:saved.revision,action:'reset'});assert.equal(restored.content,initial.content);assert.equal(restored.history[0].content,content);
});
test('invalid skill content and unknown ids cannot mutate the library',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'generation-skills-'));t.after(()=>rm(dir,{recursive:true,force:true}));const skills=createGenerationSkills(dir);
 const skill=await skills.get('prd-annotations');
 for(const content of ['', 'plain text',skill.content.replace('name: prd-annotations','name: different')])await assert.rejects(skills.save({id:skill.id,revision:skill.revision,content}),{statusCode:400});
 await assert.rejects(skills.get('../other'),{statusCode:400});assert.equal((await skills.get(skill.id)).revision,skill.revision);
});
