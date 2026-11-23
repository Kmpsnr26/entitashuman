import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAleCoreCreatorCredentials} from '../nara-core/studio/creator-env.mjs';

test('AleCore Creator credentials take precedence over legacy NARA variables',()=>{
  assert.deepEqual(resolveAleCoreCreatorCredentials({
    ALECORE_CREATOR_USERNAME:'alecore-owner',
    ALECORE_CREATOR_PASSWORD:'new-secret-value',
    NARA_CREATOR_USERNAME:'legacy-owner',
    NARA_CREATOR_PASSWORD:'legacy-secret-value'
  }),{
    username:'alecore-owner',
    password:'new-secret-value'
  });
});

test('legacy Creator credentials remain supported and blank AleCore values fall back',()=>{
  assert.deepEqual(resolveAleCoreCreatorCredentials({
    NARA_CREATOR_USERNAME:'legacy-owner',
    NARA_CREATOR_PASSWORD:'legacy-secret-value'
  }),{
    username:'legacy-owner',
    password:'legacy-secret-value'
  });
  assert.deepEqual(resolveAleCoreCreatorCredentials({
    ALECORE_CREATOR_USERNAME:' ',
    ALECORE_CREATOR_PASSWORD:'',
    NARA_CREATOR_USERNAME:'legacy-owner',
    NARA_CREATOR_PASSWORD:'legacy-secret-value'
  }),{
    username:'legacy-owner',
    password:'legacy-secret-value'
  });
});

test('Creator username defaults safely and missing password stays unconfigured',()=>{
  assert.deepEqual(resolveAleCoreCreatorCredentials({}),{
    username:'creator',
    password:''
  });
});
