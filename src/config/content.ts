/**
 * Single source of truth for every name, figure and claim shown in the model.
 *
 * Edit text here. Set `visible: false` to hide an item everywhere.
 * Items can also be hidden live from the presenter panel (backtick key).
 *
 * Rule: nothing outside this file may hard-code a customer name, a location
 * name or a figure about Cognecto. Scenes read from here.
 */

export interface Fact {
  /** Text shown in the UI. */
  text: string
  /** Default visibility. The presenter panel can override it at runtime. */
  visible: boolean
  /** Label used in the presenter panel. */
  label: string
}

const fact = (label: string, text: string, visible = true): Fact => ({ label, text, visible })

export const facts = {
  // Brand
  wordmark: fact('Wordmark', 'cognecto'),
  tagline: fact('Tagline', 'Plan + proof. Every site, every day.'),
  systemOfRecord: fact(
    'System of record line',
    'A system of record for what happened in the physical world. Money, authority and machines act on that record, not on what someone reported.',
  ),
  hq: fact('HQ', 'Bengaluru'),

  // Footprint
  indiaStates: fact('India footprint', '12+ Indian states'),
  countriesLine: fact('Countries line', 'Australia · Madagascar · Mozambique · Sierra Leone · Cameroon'),
  comingUpLine: fact('Coming up line', 'Gabon coming up'),
  roadKm: fact('Road km figure', '20,000+ km monitored'),
  schedulerSites: fact('Scheduler site count', '17 sites'),

  // Programmes and customers (only those provided by Cognecto)
  pmgsy: fact('Road programme', 'PMGSY'),
  customerNlc: fact('Customer: NLC', 'NLC'),
  customerWcl: fact('Customer: WCL', 'WCL'),

  // Model naming. Vendor model names stay hidden by default.
  detectorLabel: fact('Detector label', 'YOLO-class detector'),
  segmenterLabel: fact('Segmenter label', 'SAM2 segmentation'),
  vlmLabel: fact('VLM label', 'VLM verifier'),
  vendorModels: fact('Vendor model names', 'Cosmos Reason 2 (edge 2B / server 8B) · Qwen planner', false),

  // Disclosure
  simulatedBadge: fact('Simulated data badge', 'SIMULATED DATA'),
} satisfies Record<string, Fact>

export type FactId = keyof typeof facts

export type Domain = 'road' | 'mine' | 'water' | 'forest'

export interface Deployment {
  id: string
  name: string
  country: string
  lat: number
  lon: number
  domain: Domain | null
  /** Customer fact id, when Cognecto has provided one. */
  customerFact: FactId | null
  status: 'live' | 'coming-up'
}

/**
 * Deployment nodes. Coordinates are approximate centroids for the state or
 * city, used only to place a marker. They do not mark a specific site.
 */
export const deployments: Deployment[] = [
  // India, roads (PMGSY)
  { id: 'in-ladakh', name: 'Ladakh', country: 'IN', lat: 34.2, lon: 77.6, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-up', name: 'Uttar Pradesh', country: 'IN', lat: 26.85, lon: 80.9, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-kerala', name: 'Kerala', country: 'IN', lat: 10.5, lon: 76.3, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-nagaland', name: 'Nagaland', country: 'IN', lat: 26.1, lon: 94.5, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-mizoram', name: 'Mizoram', country: 'IN', lat: 23.2, lon: 92.8, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-tripura', name: 'Tripura', country: 'IN', lat: 23.8, lon: 91.4, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-sikkim', name: 'Sikkim', country: 'IN', lat: 27.5, lon: 88.5, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-puducherry', name: 'Puducherry', country: 'IN', lat: 11.93, lon: 79.8, domain: 'road', customerFact: null, status: 'live' },
  { id: 'in-manipur', name: 'Manipur', country: 'IN', lat: 24.8, lon: 93.9, domain: 'road', customerFact: null, status: 'live' },
  // India, water
  { id: 'in-bhubaneswar', name: 'Bhubaneswar', country: 'IN', lat: 20.3, lon: 85.82, domain: 'water', customerFact: null, status: 'live' },
  { id: 'in-ayodhya', name: 'Ayodhya', country: 'IN', lat: 26.8, lon: 82.2, domain: 'water', customerFact: null, status: 'live' },
  // India, mines
  { id: 'in-barmer', name: 'Barmer', country: 'IN', lat: 25.75, lon: 71.39, domain: 'mine', customerFact: 'customerNlc', status: 'live' },
  { id: 'in-nagpur', name: 'Nagpur', country: 'IN', lat: 21.15, lon: 79.09, domain: 'mine', customerFact: 'customerWcl', status: 'live' },
  // International. Domain not specified by Cognecto, so left null.
  { id: 'au', name: 'Australia', country: 'AU', lat: -25.3, lon: 134.0, domain: null, customerFact: null, status: 'live' },
  { id: 'mg', name: 'Madagascar', country: 'MG', lat: -19.0, lon: 46.9, domain: null, customerFact: null, status: 'live' },
  { id: 'mz', name: 'Mozambique', country: 'MZ', lat: -18.7, lon: 35.5, domain: null, customerFact: null, status: 'live' },
  { id: 'sl', name: 'Sierra Leone', country: 'SL', lat: 8.5, lon: -11.8, domain: null, customerFact: null, status: 'live' },
  { id: 'cm', name: 'Cameroon', country: 'CM', lat: 5.7, lon: 12.7, domain: null, customerFact: null, status: 'live' },
  { id: 'ga', name: 'Gabon', country: 'GA', lat: -0.8, lon: 11.6, domain: null, customerFact: null, status: 'coming-up' },
]

/** Toggle every place name on or off at once (presenter panel has the same switch). */
export const placeNamesVisibleByDefault = true

/** Copy for the six-step loop. Wording follows Cognecto's own notes. */
export const loopSteps = [
  {
    id: 'intent',
    title: 'INTENT',
    line: 'Messy human intent becomes typed tasks.',
    detail:
      'Site metadata goes in: fleet, operators, capacities, safety rules, history. A plan comes out: tonnes to move, trips, shifts. The solver is deterministic: one exact answer we can explain.',
  },
  {
    id: 'sense',
    title: 'SENSE',
    line: 'Sense with honest uncertainty.',
    detail: 'Boson hears, Photon sees. Every reading is an IES event from the moment it is created, with its confidence attached.',
  },
  {
    id: 'schedule',
    title: 'SCHEDULER DECIDES',
    line: 'Which model runs, in what order, at what cost.',
    detail:
      'Rules set the hard limits; the scheduler picks the best option within them. Every task carries machine-checkable success criteria.',
  },
  {
    id: 'verify',
    title: 'VERIFY',
    line: 'Nobody self-reports.',
    detail:
      'Sensing checks whether the work happened. Verifier chain: rules, then anomaly check, then VLM if needed, then a human if needed.',
  },
  {
    id: 'settle',
    title: 'SETTLE',
    line: 'A signed certificate, and something real moves.',
    detail: 'Event, work order, task, machine-verified completion, payment eligibility. The state releases funds; the contractor gets paid.',
  },
  {
    id: 'learn',
    title: 'LEARN',
    line: 'Every recommendation, override and outcome is logged.',
    detail: 'What the system said, what the human did, and what actually happened. Rejection is the most valuable part.',
  },
] as const

export type LoopStepId = (typeof loopSteps)[number]['id']

export const ontologyPrimitives = ['Entity', 'Zone', 'Operation', 'Plan', 'Event', 'Binding', 'Admin Geography', 'Person'] as const

export const layers = [
  { id: 'boson', name: 'Boson', verb: 'hear', line: 'IoT sensors, meters, telemetry. Any meter brand.' },
  { id: 'photon', name: 'Photon', verb: 'see', line: 'Edge detectors, road segmentation, VLM checks.' },
  { id: 'cortex', name: 'Cortex', verb: 'act', line: 'Ontology, site Correlator, Event Ledger.' },
] as const

export const phyos = {
  name: 'phyOS',
  line: 'Base-layer data model for physical infrastructure. Append-only: assets get observations, observations get resolved.',
}
