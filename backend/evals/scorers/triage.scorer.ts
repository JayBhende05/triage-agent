export interface TriageScore {
  passed : boolean;
  expected : string;
  actual : string;
}


export function scoreTriage(expected : string , actual : string){
  return {
    passed :expected == actual,
    expected : expected,
    actual : actual
  }
}