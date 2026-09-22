const secretPatterns=[
 /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|GH_TOKEN|GEMINI_API_KEY|GOOGLE_API_KEY|XAI_API_KEY|DEEPSEEK_API_KEY|ASKCODI_API_KEY)\s*[:=]\s*[^\s"'\r\n]+/gi,
 /\bAuthorization\s*:\s*Bearer\s+[^\s"'\r\n]+/gi,
 /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
 /\bsk-[A-Za-z0-9_-]{8,}/g,
 /\b(password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*[^\s"'\r\n]+/gi
];

export function redactSecrets(value=''){
 let text=String(value);
 for(const pattern of secretPatterns)text=text.replace(pattern,match=>{
  const index=match.search(/[:=]/);
  return index>=0?match.slice(0,index+1)+' [REDACTED]':'[REDACTED]';
 });
 return text;
}

export function containsSensitiveInput(command=''){
 const text=String(command);
 return secretPatterns.some(pattern=>{pattern.lastIndex=0;return pattern.test(text);});
}

const blocked=[
 /(?:curl|wget|invoke-webrequest|irm|iwr).*(?:token|secret|api[_ -]?key|authorization|\$env:)/i,
 /(?:password|credential).*(?:chrome|edge|firefox|browser)/i,
 /(?:set-mppreference|add-mppreference).*(?:disable|exclusion)/i,
 /(?:windows defender|securityhealth|windefend).*(?:disable|stop)/i,
 /(?:format\s+[a-z]:|diskpart|clear-disk|remove-partition)/i,
 /(?:remove-item|del|erase|rd|rmdir|rm)\b.*(?:[a-z]:\\\s*$|[a-z]:\\\*|\\windows\\|\\users\\.*-recurse|\/\s*$)/i
];

const confirm=[
 /^\s*git\s+(?:push|reset|clean|checkout\s+--|restore\s+\.)\b/i,
 /^\s*npm\s+publish\b/i,
 /^\s*(?:remove-item|del|erase|rd|rmdir|rm)\b/i,
 /^\s*stop-process\b/i,
 /^\s*(?:winget|choco|scoop)\s+(?:install|uninstall|upgrade)\b/i,
 /^\s*(?:reg(?:\.exe)?\s+(?:add|delete)|set-itemproperty\s+HK|new-itemproperty\s+HK)\b/i,
 /^\s*(?:sc(?:\.exe)?\s+(?:create|delete|config|stop)|net\s+(?:stop|start)|restart-service|stop-service|start-service)\b/i,
 /^\s*(?:shutdown|restart-computer|stop-computer)\b/i
];

const safe=[
 /^\s*git\s+(?:status|diff|log|show|branch(?:\s+--show-current)?|rev-parse|remote\s+-v)\b/i,
 /^\s*(?:node|npm|npx|python|py|pip|git|gh|claude|codex|agent|gemini)\s+--version\s*$/i,
 /^\s*npm\s+(?:test|run\s+(?:build|test|lint|typecheck|verify))\b/i,
 /^\s*(?:get-childitem|get-location|pwd|dir|ls)\b/i,
 /^\s*where(?:\.exe)?\s+[A-Za-z0-9._-]+\s*$/i
];

export function classifyCommand(command=''){
 const text=String(command).trim();
 if(!text||text.length>4000)return {level:'BLOCK',reason:'Command kosong atau terlalu panjang.'};
 if(/\r|\n/.test(text))return {level:'CONFIRM',reason:'Command multi-baris memerlukan konfirmasi.'};
 if(blocked.some(re=>re.test(text)))return {level:'BLOCK',reason:'Command berisiko tinggi diblokir oleh kebijakan terminal Dudidam.'};
 if(containsSensitiveInput(text))return {level:'CONFIRM',reason:'Command tampak mengandung informasi sensitif.'};
 if(confirm.some(re=>re.test(text)))return {level:'CONFIRM',reason:'Command dapat mengubah sistem, project, paket, atau remote repository.'};
 if(safe.some(re=>re.test(text)))return {level:'SAFE',reason:'Command inspeksi/test/build yang dibatasi.'};
 return {level:'CONFIRM',reason:'Command belum termasuk allowlist otomatis.'};
}
