"""
Free Cash Finance Automation - Monitoring Orchestrator
======================================================

RULE #2 IMPLEMENTATION:
This orchestrator enforces single daily execution with idempotency checks.
Execution window: UTC+02:00 morning (05:30-09:30 local time = 04:30-08:30 UTC).

Usage:
    python src/orchestrator.py [config_path]
    
Exit codes:
    0 - Success (all rules passed)
    1 - Rule violation detected
    2 - Approval required (waiting on human response)
    3 - Configuration error
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Import from same package to enable type hints
from src.rule_engine import RuleEngine
from src.wait_gate import WaitGate
from src.notify_manager import NotifyManager
from src.api_client import FinanceAPIClient


__version__ = "0.1.0"
logger = logging.getLogger(__name__)


class MonitorOrchestrator:
    """
    Daily monitoring orchestrator that enforces the 4 operational rules:
    
    Rule #1: Zero automated earning actions
    Rule #2: Once-per-day check (idempotency)
    Rule #3: Notify on changes
    Rule #4: Human approval required
    """
    
    def __init__(self, config_path: Optional[Path] = None):
        self._config = config_path or Path(__file__).parent.parent / "config" / "monitor.json"
        self._rule_engine: Optional[RuleEngine] = None
        self._wait_gate: Optional[WaitGate] = None
        self._notify_manager: Optional[NotifyManager] = None
        self._api_client: Optional[FinanceAPIClient] = None
        self._execution_timestamp: Optional[datetime] = None
    
    @property
    def config(self) -> Path:
        """Get normalized config file path."""
        return self._config if self._config.exists() else (self._config.parent / "monitor.json")
    
    def initialize(self) -> bool:
        """Initialize all components and load configuration. Returns False on error."""
        try:
            # Load configuration safely
            import json
            config_data = {k: v for k, v in self._config.items()}
            
            # Rule #2: Check idempotency here too
            if (self.config.parent / f"last_check_{datetime.now().strftime('%Y-%m-%d')}.flag").exists():
                logger.warning("Daily check already ran today - skipping re-initialization")
                return True  # Already initialized this day
            
            self._rule_engine = RuleEngine()
            self._wait_gate = WaitGate(self.config)
            self._notify_manager = NotifyManager(self.config)
            self._api_client = FinanceAPIClient(sandbox_mode=True)
            
            logger.info(f"MonitorOrchestrator initialized, config: {self.config}")
            return True
            
        except Exception as e:
            logger.error(f"Initialization failed: {e}")
            raise
    
    def _record_execution_timestamp(self) -> datetime:
        """Record execution start time with timezone normalization."""
        tz_utc = timezone(timedelta(hours=0))
        self._execution_timestamp = datetime.now(tz=tz_utc)
        return self._execution_timestamp
    