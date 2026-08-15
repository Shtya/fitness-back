import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('gold_data_sources')
@Index('uq_gold_source_name', ['sourceName'], { unique: true })
export class GoldDataSourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_name', type: 'varchar', length: 80 })
  sourceName: string;

  @Column({ name: 'source_type', type: 'varchar', length: 40 })
  sourceType: string;

  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  status: string;

  @Column({ name: 'last_successful_fetch', type: 'timestamptz', nullable: true })
  lastSuccessfulFetch: Date | null;

  @Column({ name: 'last_data_timestamp', type: 'timestamptz', nullable: true })
  lastDataTimestamp: Date | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({ name: 'data_quality_score', type: 'float', default: 0 })
  dataQualityScore: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'meta_json', type: 'jsonb', default: {} })
  metaJson: Record<string, any>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('gold_price_ticks')
@Index('idx_gold_ticks_symbol_ts', ['symbol', 'observedAt'])
export class GoldPriceTickEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 24, default: 'XAUUSD' })
  symbol: string;

  @Column({ type: 'float' })
  mid: number;

  @Column({ type: 'float', nullable: true })
  bid: number | null;

  @Column({ type: 'float', nullable: true })
  ask: number | null;

  @Column({ type: 'float', nullable: true })
  spread: number | null;

  @Column({ type: 'varchar', length: 8, default: 'USD' })
  currency: string;

  @Column({ type: 'varchar', length: 24, default: 'troy_ounce' })
  unit: string;

  @Column({ type: 'varchar', length: 48 })
  source: string;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt: Date;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'varchar', length: 16, default: 'DELAYED' })
  freshness: string;

  @Column({ name: 'quality_score', type: 'float', default: 50 })
  qualityScore: number;

  @Column({ name: 'validation_status', type: 'varchar', length: 24, default: 'ok' })
  validationStatus: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('gold_ohlcv')
@Index('uq_gold_ohlcv', ['symbol', 'timeframe', 'barTime', 'source'], { unique: true })
export class GoldOhlcvEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 24, default: 'XAUUSD' })
  symbol: string;

  @Column({ type: 'varchar', length: 8, default: '1D' })
  timeframe: string;

  @Column({ name: 'bar_time', type: 'timestamptz' })
  barTime: Date;

  @Column({ type: 'float' })
  open: number;

  @Column({ type: 'float' })
  high: number;

  @Column({ type: 'float' })
  low: number;

  @Column({ type: 'float' })
  close: number;

  @Column({ type: 'float', nullable: true })
  volume: number | null;

  @Column({ type: 'varchar', length: 48 })
  source: string;

  @Column({ name: 'close_only', type: 'boolean', default: false })
  closeOnly: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('gold_macro_obs')
@Index('uq_gold_macro', ['seriesId', 'obsDate', 'source'], { unique: true })
export class GoldMacroObservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'series_id', type: 'varchar', length: 32 })
  seriesId: string;

  @Column({ name: 'obs_date', type: 'date' })
  obsDate: string;

  @Column({ type: 'float' })
  value: number;

  @Column({ type: 'varchar', length: 48 })
  source: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('gold_news')
@Index('uq_gold_news_url', ['url'], { unique: true })
export class GoldNewsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 400 })
  headline: string;

  @Column({ type: 'varchar', length: 80 })
  source: string;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt: Date;

  @Column({ type: 'varchar', length: 24, default: 'Neutral' })
  impact: string;

  @Column({ name: 'impact_score', type: 'int', default: 0 })
  impactScore: number;

  @Column({ type: 'int', default: 40 })
  confidence: number;

  @Column({ name: 'time_horizon', type: 'varchar', length: 16, default: '1D' })
  timeHorizon: string;

  @Column({ name: 'novelty_score', type: 'float', default: 1 })
  noveltyScore: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'already_known', type: 'boolean', default: false })
  alreadyKnown: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('gold_cftc')
@Index('uq_gold_cftc_date', ['reportDate'], { unique: true })
export class GoldCftcEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'report_date', type: 'date' })
  reportDate: string;

  @Column({ name: 'market_name', type: 'varchar', length: 160, nullable: true })
  marketName: string | null;

  @Column({ name: 'open_interest', type: 'float', nullable: true })
  openInterest: number | null;

  @Column({ name: 'noncomm_long', type: 'float', nullable: true })
  noncommLong: number | null;

  @Column({ name: 'noncomm_short', type: 'float', nullable: true })
  noncommShort: number | null;

  @Column({ name: 'noncomm_net', type: 'float', nullable: true })
  noncommNet: number | null;

  @Column({ name: 'comm_long', type: 'float', nullable: true })
  commLong: number | null;

  @Column({ name: 'comm_short', type: 'float', nullable: true })
  commShort: number | null;

  @Column({ type: 'jsonb', default: {} })
  raw: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('gold_predictions')
@Index('idx_gold_predictions_ts', ['predictionTimestamp'])
export class GoldPredictionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'time_horizon', type: 'varchar', length: 8 })
  timeHorizon: string;

  @Column({ name: 'model_version', type: 'varchar', length: 32 })
  modelVersion: string;

  @Column({ type: 'varchar', length: 16 })
  direction: string;

  @Column({ name: 'probability_up', type: 'float' })
  probabilityUp: number;

  @Column({ name: 'probability_down', type: 'float' })
  probabilityDown: number;

  @Column({ name: 'probability_neutral', type: 'float' })
  probabilityNeutral: number;

  @Column({ name: 'expected_return', type: 'float', nullable: true })
  expectedReturn: number | null;

  @Column({ type: 'float' })
  confidence: number;

  @Column({ name: 'price_at_prediction', type: 'float', nullable: true })
  priceAtPrediction: number | null;

  @Column({ name: 'actual_return', type: 'float', nullable: true })
  actualReturn: number | null;

  @Column({ name: 'correct', type: 'boolean', nullable: true })
  correct: boolean | null;

  @Column({ name: 'data_timestamp', type: 'timestamptz', nullable: true })
  dataTimestamp: Date | null;

  @Column({ name: 'prediction_timestamp', type: 'timestamptz', default: () => 'now()' })
  predictionTimestamp: Date;

  @Column({ name: 'regime_json', type: 'jsonb', default: [] })
  regimeJson: string[];

  @Column({ name: 'features_json', type: 'jsonb', default: {} })
  featuresJson: Record<string, any>;

  @Column({ name: 'provenance_json', type: 'jsonb', default: {} })
  provenanceJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('gold_alerts')
@Index('idx_gold_alerts_user', ['userId'])
export class GoldAlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'alert_type', type: 'varchar', length: 40 })
  alertType: string;

  @Column({ type: 'float', nullable: true })
  threshold: number | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'last_triggered_at', type: 'timestamptz', nullable: true })
  lastTriggeredAt: Date | null;

  @Column({ name: 'last_message', type: 'text', nullable: true })
  lastMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('gold_user_settings')
@Index('uq_gold_user_settings', ['userId'], { unique: true })
export class GoldUserSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'capital_usd', type: 'float', default: 10000 })
  capitalUsd: number;

  @Column({ name: 'holding_period', type: 'varchar', length: 24, default: '3 months' })
  holdingPeriod: string;

  @Column({ name: 'risk_tolerance', type: 'varchar', length: 16, default: 'medium' })
  riskTolerance: string;

  @Column({ name: 'local_21k_egp', type: 'float', nullable: true })
  local21kEgp: number | null;

  @Column({ name: 'local_24k_egp', type: 'float', nullable: true })
  local24kEgp: number | null;

  @Column({ name: 'local_18k_egp', type: 'float', nullable: true })
  local18kEgp: number | null;

  @Column({ name: 'poll_minutes', type: 'int', default: 5 })
  pollMinutes: number;

  @Column({ name: 'weights_json', type: 'jsonb', default: {} })
  weightsJson: Record<string, number>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('gold_snapshots')
export class GoldSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'payload_json', type: 'jsonb' })
  payloadJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export const GOLD_INTELLIGENCE_ENTITIES = [
  GoldDataSourceEntity,
  GoldPriceTickEntity,
  GoldOhlcvEntity,
  GoldMacroObservationEntity,
  GoldNewsEntity,
  GoldCftcEntity,
  GoldPredictionEntity,
  GoldAlertEntity,
  GoldUserSettingsEntity,
  GoldSnapshotEntity,
];
