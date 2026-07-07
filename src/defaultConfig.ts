import type { FrontLensConfig } from './types.js';

export function createDefaultConfig(url = 'about:blank'): FrontLensConfig {
  return {
    target: {
      url
    },
    browser: {
      name: 'chromium',
      headless: true,
      viewport: {
        width: 1440,
        height: 900
      },
      timeoutMs: 45_000,
      waitUntil: 'domcontentloaded',
      extraWaitMs: 1_500
    },
    auth: {},
    safety: {
      allowCreate: false,
      allowEdit: false,
      allowDelete: false,
      allowUpload: false,
      allowDownload: false,
      allowSubmit: false,
      blockMutatingRequests: true,
      readOnlyPostPatterns: ['/list', '/search', '/query', '/page', '/filter']
    },
    security: {
      enabled: true,
      mode: 'passive',
      checkHeaders: true,
      checkCookies: true,
      checkSensitiveData: true,
      checkMixedContent: true,
      checkThirdPartyResources: true,
      checkXssPassive: true,
      checkCsrfHints: true,
      checkApiLeaks: true,
      activeProbing: false
    },
    journeys: {
      enabled: true,
      continueOnFailure: true,
      maxJourneys: 5,
      maxStepsPerJourney: 30,
      journeys: [
        {
          name: 'Default page smoke journey',
          steps: [
            { action: 'waitForLoad', description: '等待页面完成基础加载' },
            { action: 'expectVisible', target: 'body', description: '确认页面主体可见' }
          ]
        }
      ]
    },
    requirements: {
      enabled: true,
      inferFromPage: true,
      items: []
    },
    productContext: {
      enabled: true,
      pageType: 'unknown',
      deviceScope: 'unknown',
      accessibilityTarget: 'basic',
      requiredFeatures: [],
      optionalFeatures: [],
      outOfScopeFeatures: [],
      decisions: [],
      adrRefs: []
    },
    contract: {
      enabled: true,
      inferFromTraffic: true,
      strict: false,
      maxBodyExamples: 30
    },
    realtime: {
      enabled: true,
      captureWebSocket: true,
      captureSse: true,
      maxMessages: 50
    },
    p2: {
      enabled: true,
      visual: {
        enabled: true,
        diffThresholdRatio: 0.01
      },
      budgets: {
        enabled: true,
        fcpMs: 1800,
        loadMs: 3000,
        totalTransferKb: 2000,
        domNodes: 2000,
        longTaskCount: 5,
        cls: 0.1
      },
      networkProfiles: {
        enabled: true,
        profiles: ['offline', 'slow-3g']
      }
    },
    exploration: {
      maxDepth: 1,
      maxPages: 1,
      maxActionsPerPage: 30,
      include: [],
      exclude: ['/logout', '/signout', '/delete', '/remove', '/destroy']
    },
    analysis: {
      network: true,
      console: true,
      resource: true,
      coverage: true,
      accessibility: true,
      seo: false,
      performance: true,
      integration: true,
      responsive: true,
      ai: true,
      slowRequestMs: 1_500,
      slowResourceMs: 1_500,
      largeResourceBytes: 1_000_000,
      coverageMinBytes: 50_000,
      coverageUnusedPercent: 60,
      maxResponsePreviewBytes: 64_000
    },
    responsive: {
      viewports: [
        { name: 'desktop', width: 1440, height: 900 },
        { name: 'laptop', width: 1366, height: 768 },
        { name: 'tablet', width: 768, height: 1024 },
        { name: 'mobile', width: 390, height: 844 }
      ]
    },
    exception: {
      enabled: true,
      delayMs: 3_000
    },
    plugins: {
      analyzers: [],
      reporters: [],
      rules: []
    },
    ai: {
      provider: 'heuristic',
      maxIssues: 20,
      maxContextBytes: 120_000
    },
    report: {
      formats: ['json', 'markdown'],
      outputDir: './reports/frontlens',
      trace: false,
      screenshot: true,
      video: false,
      domSnapshot: true
    }
  };
}
