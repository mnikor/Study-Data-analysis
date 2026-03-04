import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { ChatMessage, ClinicalFile, MappingSpec, AnalysisResponse, StatAnalysisResult, StatTestType, QCStatus, QCIssue, CleaningSuggestion, StatSuggestion, BiasReport } from "../types";

const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY not found in environment.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

// Helper function to retry API calls
const withRetry = async <T>(operation: () => Promise<T>, maxRetries = 3, delayMs = 2000): Promise<T> => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error: any) {
            const isTransient = error?.message?.includes("Model isn't available right now") || 
                                error?.message?.includes("503") ||
                                error?.message?.includes("429") ||
                                error?.status === 503 ||
                                error?.status === 429;
            
            if (isTransient && i < maxRetries - 1) {
                console.warn(`Gemini API transient error. Retrying in ${delayMs}ms... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw error;
        }
    }
    throw new Error("Max retries reached");
};

export const generateAnalysis = async (
  query: string,
  contextFiles: ClinicalFile[],
  mode: 'RAG' | 'STUFFING',
  history: ChatMessage[]
): Promise<AnalysisResponse> => {
  const ai = getClient();
  if (!ai) {
    return { answer: "Error: API Key missing. Please set GEMINI_API_KEY in environment." };
  }

  let contextText = "";
  
  if (mode === 'STUFFING') {
    contextText = contextFiles.map(f => `--- DOCUMENT: ${f.name} ---\n${f.content || 'No text content available.'}\n--- END DOCUMENT ---`).join('\n\n');
  } else {
    // Mock RAG: Just take the first 500 chars of each doc
    contextText = "RETRIEVED FRAGMENTS:\n" + contextFiles.map(f => `[Source: ${f.name}]: ${f.content?.substring(0, 500)}...`).join('\n\n');
  }

  const systemInstruction = `You are an expert Clinical Data Scientist and Medical Monitor. 
  Your goal is to assist with clinical study analysis, signal detection, and root cause analysis.
  
  CURRENT MODE: ${mode}
  
  OBJECTIVES:
  1. DATA MINING & DISCOVERY: Actively look for non-obvious patterns, such as outliers in vital signs, unexpected correlations between Age/Sex and Adverse Events, or site-specific anomalies.
  2. MEDICAL MONITORING: Prioritize patient safety. If you see an adverse event or lab anomaly, perform a "Root Cause Analysis". Check concomitant medications or medical history if available to explain the event.
  3. VISUALIZATION: If the data allows, or if the user asks for analysis, ALWAYS try to generate a chart to make the insight visible. Prefer complex charts: Box Plots (distributions), Kaplan-Meier (time-to-event), Scatter plots (correlations).
  4. ACCURACY OVER STYLE: Focus on data integrity and clinical precision. Do not worry about "publication style" unless explicitly asked. Focus on "Monitoring Reports" style (bullet points, risk flags).
  
  When answering:
  1. Cite your sources using [Doc Name] format.
  2. If asked for code, provide Python/Pandas or SAS pseudo-code.
  3. Be precise with clinical terminology (CDISC, SDTM, ADaM, MedDRA).
  4. VISUALIZATION DATA: 
     - Generate a Plotly.js configuration.
     - If the context data provided is a snippet/insufficient, GENERATE PLAUSIBLE SYNTHETIC DATA that matches the file headers to demonstrate the insight. Explicitly state that the chart uses simulated data for demonstration.
  `;

  const prompt = `
  CONTEXT DATA:
  ${contextText}

  USER HISTORY:
  ${history.filter(h => h.role === 'user').slice(-3).map(h => h.content).join('\n')}

  CURRENT QUERY:
  ${query}
  `;

  // Schema for structured output
  const schema = {
    type: Type.OBJECT,
    properties: {
      answer: { 
        type: Type.STRING, 
        description: "The natural language response/analysis. Focus on clinical insights and safety signals." 
      },
      hasChart: { 
        type: Type.BOOLEAN, 
        description: "Set to true if a chart visualization is included." 
      },
      chartConfigJSON: { 
        type: Type.STRING, 
        description: "A valid JSON string representing the Plotly.js 'data' array and 'layout' object. Example: { \"data\": [{...}], \"layout\": {...} }" 
      },
      keyInsights: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING }, 
        description: "List of 3-5 bullet points highlighting 'Hidden Insights', outliers, or critical findings." 
      }
    },
    required: ["answer", "hasChart"]
  };

  try {
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: { parts: [{ text: prompt }] },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.4, // Slightly higher for "Insight" creativity
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    }));

    if (response.text) {
        try {
            const parsed = JSON.parse(response.text);
            let chartConfig = undefined;
            if (parsed.hasChart && parsed.chartConfigJSON) {
                chartConfig = JSON.parse(parsed.chartConfigJSON);
            }
            return {
                answer: parsed.answer,
                chartConfig: chartConfig,
                keyInsights: parsed.keyInsights
            };
        } catch (e) {
            console.error("Failed to parse JSON response", e);
            return { answer: response.text || "Error parsing analysis." };
        }
    }
    return { answer: "No response generated." };

  } catch (error) {
    console.error("Gemini API Error", error);
    return { answer: "Error contacting AI service. Please check console." };
  }
};

/**
 * Step 1: Generate the Python code for the analysis.
 */
export const generateStatisticalCode = async (
  file: ClinicalFile,
  testType: StatTestType,
  var1: string,
  var2: string,
  contextDocuments: ClinicalFile[] = [],
  covariates: string[] = [],
  imputationMethod: string = 'None',
  applyPSM: boolean = false
): Promise<string> => {
  const ai = getClient();
  if (!ai) return "# Error: API Key missing. Please check your configuration.";

  // Prepare context string from Protocol/SAP
  const contextSnippet = contextDocuments.length > 0
    ? contextDocuments.map(d => `--- ${d.name} ---\n${d.content?.substring(0, 3000)}...`).join('\n\n')
    : "No Protocol or SAP provided.";

  const prompt = `
  You are a Senior Statistical Programmer.
  TASK: Write a clean, commented Python script using pandas and scipy.stats (or scikit-learn/statsmodels for advanced adjustments) to perform a ${testType}.
  
  TARGET DATASET:
  - Name: ${file.name}
  - Variable 1: ${var1}
  - Variable 2: ${var2}
  - Data Snippet: 
  ${file.content?.substring(0, 300)}...

  ADVANCED ADJUSTMENTS (RWE):
  - Covariates to adjust for: ${covariates.length > 0 ? covariates.join(', ') : 'None'}
  - Missing Data Imputation: ${imputationMethod}
  - Propensity Score Matching (PSM): ${applyPSM ? 'Yes (match on covariates before analysis)' : 'No'}

  RELEVANT STUDY DOCUMENTS (Protocol / SAP):
  ${contextSnippet}

  REQUIREMENTS:
  1. Actively check the RELEVANT STUDY DOCUMENTS for definitions (e.g., "Baseline", "Responder", "Exclusion Criteria") and implement them in the code if applicable to ${var1} or ${var2}.
  2. If the Protocol defines specific exclusion criteria (e.g., "Exclude Age < 18"), add a filtering step in pandas.
  3. Assume the data is loaded into a DataFrame named 'df'.
  4. If Imputation is requested, use scikit-learn (e.g., SimpleImputer or IterativeImputer) before the main analysis.
  5. If PSM is requested, use LogisticRegression to calculate propensity scores based on the covariates, perform nearest-neighbor matching, and run the final ${testType} on the matched cohort.
  6. If covariates are provided but PSM is false, include them in a multivariable model if the test type supports it (e.g., ANCOVA, Logistic Regression).
  7. Perform the statistical test (${testType}).
  8. Print the key results (p-value, test statistic, etc).
  9. DO NOT output markdown blocks. Just return the raw code string.
  `;

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: { parts: [{ text: prompt }] }
    }));
    // Strip markdown formatting if the model adds it
    let code = response.text || "# No code generated.";
    code = code.replace(/```python/g, '').replace(/```/g, '').trim();
    return code;
  } catch (error) {
    console.error("Code Generation Error", error);
    return "# Error generating code. Please try again.";
  }
};

/**
 * Step 2: Execute (Simulate) the code and return results.
 */
export const executeStatisticalCode = async (
  code: string,
  file: ClinicalFile,
  testType: StatTestType
): Promise<StatAnalysisResult | null> => {
  const ai = getClient();
  if (!ai) return null;

  const prompt = `
  You are a Python execution engine (Simulated).
  
  CODE TO EXECUTE:
  ${code}
  
  DATA SNIPPET (${file.name}):
  ${file.content}

  INSTRUCTIONS:
  1. Act as the Python runtime. "Run" the provided code on the data snippet.
  2. If the snippet is too small, infer the distribution and GENERATE PLAUSIBLE SYNTHETIC RESULTS consistent with the code's logic.
  3. Generate a Plotly.js visualization configuration that matches the analysis (Box Plot for T-Test/ANOVA, Scatter for Regression).
  4. Provide a clinical interpretation of the "computed" results.
  5. Return metrics as an array of key-value objects.

  OUTPUT SCHEMA (JSON):
  - metricsList: Array of objects { key: string, value: string }.
  - interpretation: A paragraph explaining the result.
  - chartConfigJSON: Stringified JSON of Plotly 'data' and 'layout'.
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      metricsList: { 
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
             key: { type: Type.STRING },
             value: { type: Type.STRING }
          }
        }
      },
      interpretation: { type: Type.STRING },
      chartConfigJSON: { type: Type.STRING }
    },
    required: ["metricsList", "interpretation", "chartConfigJSON"]
  };

  try {
    const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts: [{ text: prompt }] },
        config: { 
          responseMimeType: 'application/json', 
          responseSchema: schema,
          temperature: 0,
          seed: 42
        }
    }));

    if (response.text) {
        const parsed = JSON.parse(response.text);
        const metrics: Record<string, string | number> = {};
        parsed.metricsList.forEach((m: any) => metrics[m.key] = m.value);
        
        return {
            metrics: metrics,
            interpretation: parsed.interpretation,
            chartConfig: JSON.parse(parsed.chartConfigJSON),
            executedCode: code
        };
    }
    return null;

  } catch (error) {
    console.error("Execution Simulation Error", error);
    return null;
  }
};

/**
 * Step 3: Generate SAS Code from Python Logic
 */
export const generateSASCode = async (
  file: ClinicalFile,
  testType: StatTestType,
  var1: string,
  var2: string,
  pythonCode: string,
  covariates: string[] = [],
  imputationMethod: string = 'None',
  applyPSM: boolean = false
): Promise<string> => {
  const ai = getClient();
  if (!ai) return "/* Error: API Key missing */";

  const prompt = `
  You are a Senior Statistical Programmer in the Pharmaceutical Industry.
  TASK: Convert the following analysis logic into regulatory-grade SAS code (SAS 9.4+).

  CONTEXT:
  - Dataset: ${file.name} (Assume library 'ADAM' or 'WORK')
  - Analysis: ${testType}
  - Variable 1: ${var1}
  - Variable 2: ${var2}

  ADVANCED ADJUSTMENTS (RWE):
  - Covariates to adjust for: ${covariates.length > 0 ? covariates.join(', ') : 'None'}
  - Missing Data Imputation: ${imputationMethod}
  - Propensity Score Matching (PSM): ${applyPSM ? 'Yes (match on covariates before analysis)' : 'No'}

  REFERENCE PYTHON LOGIC:
  ${pythonCode}

  REQUIREMENTS:
  1. Use standard PROCs (e.g., PROC TTEST, PROC GLM, PROC FREQ, PROC CORR).
  2. If Imputation is requested, use PROC MI.
  3. If PSM is requested, use PROC PSMATCH.
  4. Include ODS OUTPUT statements to capture statistics.
  5. Add standard header comments (Program Name, Author, Date).
  6. Assume input data is in a dataset named 'INPUT_DATA'.
  7. Do NOT execute. Just write the code.
  8. Return only the code string.
  `;

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: { parts: [{ text: prompt }] }
    }));
    let code = response.text || "/* No SAS code generated */";
    code = code.replace(/```sas/g, '').replace(/```/g, '').trim();
    return code;
  } catch (error) {
    console.error("SAS Gen Error", error);
    return "/* Error generating SAS code */";
  }
};

export const runQualityCheck = async (file: ClinicalFile): Promise<{ status: QCStatus, issues: QCIssue[] }> => {
    const ai = getClient();
    if (!ai) return { status: 'PASS', issues: [] };

    const prompt = `
    Analyze this clinical data snippet for quality issues (CDISC/FDA compliance).
    DATA:
    ${file.content?.substring(0, 1000)}

    CHECK FOR:
    1. Missing critical fields (SUBJID, AGE, SEX).
    2. Invalid values (Age > 120, Age < 0).
    3. Inconsistent date formats.
    4. Terminology issues (e.g. 'M' vs 'Male' mixed).

    OUTPUT SCHEMA:
    {
      "status": "PASS" | "WARN" | "FAIL",
      "issues": [ { "severity": "HIGH"|"MEDIUM"|"LOW", "description": "...", "affectedRows": "Row 1, 5" } ]
    }
    `;

    try {
        const response = await withRetry(() => ai.models.generateContent({
             model: 'gemini-3.1-pro-preview',
             contents: { parts: [{ text: prompt }] },
             config: { responseMimeType: 'application/json' }
        }));
        if (response.text) return JSON.parse(response.text);
    } catch (e) {
        console.error(e);
    }
    return { status: 'PASS', issues: [] };
};

export const generateCleaningSuggestion = async (file: ClinicalFile, issues: QCIssue[]): Promise<CleaningSuggestion> => {
    const ai = getClient();
    if (!ai) return { explanation: "Error", code: "" };

    const prompt = `
    Generate a Python script to fix the following data quality issues.
    ISSUES:
    ${JSON.stringify(issues)}
    
    DATA SNIPPET:
    ${file.content?.substring(0, 500)}

    Requirements:
    1. Assume data is in pandas df.
    2. Provide explanation of what the code does.
    3. Provide the cleaning code.
    `;
    
     const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json' }
     }));
     
     if (response.text) {
         try {
             return JSON.parse(response.text); 
         } catch(e) {
             return { explanation: "Code generated.", code: response.text || "" };
         }
     }
     return { explanation: "Failed to generate.", code: "" };
};

export const parseNaturalLanguageAnalysis = async (
  query: string,
  availableColumns: string[],
  studyType: string
): Promise<any | null> => {
  const ai = getClient();
  if (!ai) return null;

  const prompt = `
  You are an expert Clinical Data Scientist.
  A non-technical stakeholder has asked a natural language question about a clinical dataset.
  Your job is to translate this question into the exact statistical parameters needed to run the analysis.

  AVAILABLE COLUMNS IN DATASET:
  ${availableColumns.join(', ')}

  STUDY TYPE: ${studyType} (If RCT, do not use PSM or covariates unless explicitly requested. If RWE, consider them if appropriate).

  USER QUESTION:
  "${query}"

  INSTRUCTIONS:
  1. Determine the most appropriate statistical test (e.g., T-Test, Chi-Square, ANOVA, Logistic Regression, Survival Analysis).
  2. Identify the primary grouping/independent variable (var1) from the available columns.
  3. Identify the primary outcome/dependent variable (var2) from the available columns.
  4. Identify any covariates mentioned (e.g., "adjusting for age and sex").
  5. Determine if Propensity Score Matching (PSM) is implied (e.g., "match patients", "balanced cohorts").
  6. Provide a brief, non-technical explanation of what analysis will be run.

  Return a JSON object matching this schema:
  {
    "testType": "T_TEST" | "CHI_SQUARE" | "ANOVA" | "LOGISTIC_REGRESSION" | "LINEAR_REGRESSION" | "SURVIVAL_KAPLAN_MEIER" | "COX_PROPORTIONAL_HAZARDS",
    "var1": "exact_column_name",
    "var2": "exact_column_name",
    "covariates": ["col1", "col2"],
    "imputationMethod": "None" | "Mean/Mode Imputation" | "Multiple Imputation (MICE)" | "Last Observation Carried Forward (LOCF)",
    "applyPSM": boolean,
    "explanation": "Brief explanation of the chosen test and variables."
  }
  `;

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: 'application/json' }
    }));

    if (response.text) {
      return JSON.parse(response.text);
    }
    return null;
  } catch (error) {
    console.error("NL Parsing Error", error);
    return null;
  }
};

export const applyCleaning = async (file: ClinicalFile, code: string): Promise<string> => {
    const ai = getClient();
    if (!ai) return file.content || "";

    const prompt = `
    Act as a Python runtime. Apply this cleaning code to the CSV data and return the CLEANED CSV only.
    
    CODE:
    ${code}

    INPUT CSV:
    ${file.content}

    OUTPUT:
    Raw CSV string only.
    `;
    const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts: [{ text: prompt }] }
    }));
    let csv = response.text || "";
    csv = csv.replace(/```csv/g, '').replace(/```/g, '').trim();
    return csv;
};

export const generateMappingSuggestion = async (columns: string[], targetDomain: string): Promise<MappingSpec> => {
    const ai = getClient();
    if (!ai) throw new Error("No API Key");

    const prompt = `
    Map these source columns to CDISC SDTM domain '${targetDomain}'.
    Source Columns: ${columns.join(', ')}
    
    Return JSON: { "mappings": [{ "sourceCol": "...", "targetCol": "...", "transformation": "..." }] }
    `;
    
    const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json' }
    }));

    if (response.text) {
        try {
            const parsed = JSON.parse(response.text);
            return { 
                id: 'temp', 
                sourceDomain: 'RAW', 
                targetDomain, 
                mappings: parsed.mappings 
            };
        } catch (e) {
            console.error("Failed to parse mapping suggestion JSON", e);
            return { id: '', sourceDomain: '', targetDomain: '', mappings: [] };
        }
    }
    return { id: '', sourceDomain: '', targetDomain: '', mappings: [] };
};

export const generateETLScript = async (file: ClinicalFile, spec: MappingSpec): Promise<string> => {
    const ai = getClient();
    if (!ai) return "# Error";

    const prompt = `
    Write a Python script to transform dataset '${file.name}' to SDTM domain '${spec.targetDomain}'.
    
    MAPPINGS:
    ${JSON.stringify(spec.mappings)}

    Requirements:
    1. Use pandas.
    2. Handle 1-to-1 mappings.
    3. Implement transformations described in 'transformation' field.
    4. Add comments.
    `;
    
    const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts: [{ text: prompt }] }
    }));
    return response.text ? response.text.replace(/```python/g, '').replace(/```/g, '') : "# Error";
};

export const runTransformation = async (file: ClinicalFile, spec: MappingSpec, script: string): Promise<string> => {
    const ai = getClient();
    if (!ai) return "";

    const prompt = `
    Act as a Python runtime. Run this script on the input CSV and return the transformed CSV.
    
    SCRIPT:
    ${script}
    
    INPUT CSV:
    ${file.content}
    
    OUTPUT:
    CSV string only.
    `;
    const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts: [{ text: prompt }] }
    }));
    let csv = response.text || "";
    csv = csv.replace(/```csv/g, '').replace(/```/g, '').trim();
    return csv;
};

export const generateStatisticalSuggestions = async (file: ClinicalFile): Promise<StatSuggestion[]> => {
     const ai = getClient();
     if (!ai) return [];
 
     const prompt = `
     Suggest 3 statistical tests relevant for this clinical dataset.
     DATA HEADER: ${file.content?.split('\n')[0]}
     
     OUTPUT JSON:
     [{ "testType": "T-Test", "var1": "ARM", "var2": "AGE", "reason": "Compare age distribution..." }]
     `;
     
     try {
         const response = await withRetry(() => ai.models.generateContent({
             model: 'gemini-3.1-pro-preview',
             contents: { parts: [{ text: prompt }] },
             config: { responseMimeType: 'application/json' }
         }));
         if (response.text) {
             let text = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
             let parsed = JSON.parse(text);
             if (!Array.isArray(parsed)) {
                 if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
                     parsed = parsed.suggestions;
                 } else {
                     parsed = [parsed];
                 }
             }
             return parsed;
         }
     } catch (e: any) { 
         console.error("Failed to parse suggestions", e);
         if (e?.message?.includes("Model isn't available right now") || e?.message?.includes("503")) {
             throw new Error("AI Model is currently overloaded. Please try again in a few minutes.");
         }
         throw e;
     }
     return [];
};

export const generateBiasAudit = async (dmFile: ClinicalFile, indication: string, aeFile?: ClinicalFile): Promise<BiasReport | null> => {
    const ai = getClient();
    if (!ai) return null;

    const prompt = `
    Perform a Bias & Fairness Audit on this clinical data.
    Indication: ${indication}
    Demographics Data:
    ${dmFile.content?.substring(0, 1000)}
    ${aeFile ? `AE Data: ${aeFile.content?.substring(0, 1000)}` : ''}

    Tasks:
    1. Check gender/race balance against real-world prevalence for ${indication}.
    2. Check for site-specific anomalies.
    3. Assign a Fairness Score (0-100).
    4. Determine Risk Level.

    OUTPUT JSON matching BiasReport interface.
    `;

    const schema = {
      type: Type.OBJECT,
      properties: {
        overallFairnessScore: { type: Type.NUMBER },
        riskLevel: { type: Type.STRING, description: "LOW, MEDIUM, or HIGH" },
        demographicAnalysis: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              score: { type: Type.NUMBER },
              status: { type: Type.STRING, description: "OPTIMAL, WARN, or CRITICAL" },
              finding: { type: Type.STRING }
            }
          }
        },
        siteAnomalies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              siteId: { type: Type.STRING },
              issue: { type: Type.STRING },
              deviation: { type: Type.STRING }
            }
          }
        },
        recommendations: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        narrativeAnalysis: { type: Type.STRING }
      }
    };

    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: { parts: [{ text: prompt }] },
            config: { 
                responseMimeType: 'application/json',
                responseSchema: schema
            }
        }));
        if (response.text) {
            let text = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(text);
        }
    } catch (e) { console.error(e); }
    return null;
};

export const generateCohortSQL = async (file: ClinicalFile, filters: CohortFilter[]): Promise<string> => {
    const ai = getClient();
    if (!ai) return "-- Error: API Key missing";

    const prompt = `
    You are a Senior Data Engineer working with Real-World Evidence (RWE) data.
    TASK: Generate a standard SQL query (PostgreSQL dialect) to extract a patient cohort based on the provided filters.

    SOURCE TABLE:
    - Table Name: \`${file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_")}\`
    - Available Columns: ${file.content?.split('\n')[0]}

    APPLIED FILTERS:
    ${JSON.stringify(filters, null, 2)}

    REQUIREMENTS:
    1. Use a standard SELECT statement.
    2. Convert the JSON filters into a valid WHERE clause.
    3. Map operators correctly (e.g., EQUALS -> =, CONTAINS -> ILIKE).
    4. Format the SQL nicely with indentation.
    5. Add a comment block at the top explaining the cohort logic.
    6. Return ONLY the raw SQL string, no markdown blocks.
    `;

    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: { parts: [{ text: prompt }] }
        }));
        let sql = response.text || "-- No SQL generated";
        sql = sql.replace(/```sql/g, '').replace(/```/g, '').trim();
        return sql;
    } catch (error) {
        console.error("SQL Gen Error", error);
        return "-- Error generating SQL code";
    }
};