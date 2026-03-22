from fastapi import APIRouter

from ...models.analysis import (
    AnalysisCapabilityRequest,
    AnalysisCapabilityResponse,
    AnalysisPlanRequest,
    AnalysisPlanResponse,
    AnalysisRunRequest,
    AnalysisRunResponse,
    WorkspaceBuildRequest,
    WorkspaceBuildResponse,
)
from ...services.analysis_service import AnalysisService


router = APIRouter(prefix="/analysis", tags=["analysis"])
service = AnalysisService()


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
