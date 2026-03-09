export interface RoutingDecision {
  provider: string;
  model: string;
  /** Set when the decision was driven by a matching routing rule */
  ruleId?: string;
}
