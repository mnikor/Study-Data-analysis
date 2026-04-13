from fastapi import APIRouter, HTTPException

from ...models.analysis import (
    AnalysisAgentPlanRequest,
    AnalysisAgentPlanResponse,
    AnalysisAgentExportResponse,
    AnalysisAgentRunRequest,
    AnalysisAgentRunResponse,
    AnalysisAgentRunSummary,
    AnalysisCapabilityRequest,
    AnalysisCapabilityResponse,
    AnalysisPlanRequest,
    AnalysisPlanResponse,
    AnalysisRunRequest,
    AnalysisRunResponse,
    WorkspaceBuildRequest,
    WorkspaceBuildResponse,
)
from ...services.analysis_agent_service import AnalysisAgentService
from ...services.analysis_service import AnalysisService


router = APIRouter(prefix="/analysis", tags=["analysis"])
service = AnalysisService()
agent_service = AnalysisAgentService()


@router.post("/capabilities", response_model=AnalysisCapabilityResponse)
def classify_capabilities(payload: AnalysisCapabilityRequest) -> AnalysisCapabilityResponse:
    return service.classify_capabilities(payload)


@router.post("/plan", response_model=AnalysisPlanResponse)
def build_plan(payload: AnalysisPlanRequest) -> AnalysisPlanResponse:
    return service.build_plan(payload)


@router.post("/build-workspace", response_model=WorkspaceBuildResponse)
def build_workspace(payload: WorkspaceBuildRequest) -> WorkspaceBuildResponse:
    return service.build_workspace(payload)


@router.post("/run", response_model=AnalysisRunResponse)
def run_analysis(payload: AnalysisRunRequest) -> AnalysisRunResponse:
    return service.run_analysis(payload)


@router.post("/agent/plan", response_model=AnalysisAgentPlanResponse)
def build_agent_plan(payload: AnalysisAgentPlanRequest) -> AnalysisAgentPlanResponse:
    return agent_service.build_plan(payload)


@router.post("/agent/run", response_model=AnalysisAgentRunResponse)
def run_analysis_agent(payload: AnalysisAgentRunRequest) -> AnalysisAgentRunResponse:
    return agent_service.run(payload)


@router.get("/agent/runs", response_model=list[AnalysisAgentRunSummary])
def list_analysis_agent_runs(limit: int = 20) -> list[AnalysisAgentRunSummary]:
    return agent_service.list_runs(limit=limit)


@router.get("/agent/run/{run_id}", response_model=AnalysisAgentRunResponse)
def get_analysis_agent_run(run_id: str) -> AnalysisAgentRunResponse:
    try:
        return agent_service.get_run(run_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/agent/run/{run_id}/export/{export_format}", response_model=AnalysisAgentExportResponse)
def export_analysis_agent_run(run_id: str, export_format: str) -> AnalysisAgentExportResponse:
    try:
        return agent_service.export_run(run_id, export_format)
    except ValueError as error:
        status_code = 404 if "not found" in str(error).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(error)) from error
