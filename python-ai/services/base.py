"""
Shared base types for enterprise AI service modules.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class ServiceResult:
    success: bool
    data: dict[str, Any]
    error: str | None = None
    module: str = ""


class EnterpriseAIService(ABC):
    """Placeholder base — future phases implement real algorithms here."""

    name: str = "base"

    @abstractmethod
    def is_available(self) -> bool:
        ...

    @abstractmethod
    def status(self) -> dict[str, Any]:
        ...

    def not_implemented(self, feature: str) -> ServiceResult:
        return ServiceResult(
            success=False,
            data={},
            error=f"{feature} not implemented — infrastructure placeholder only",
            module=self.name,
        )
