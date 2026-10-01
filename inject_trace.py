"""injection_trace.py — Capture model→tool→compression→end_turn cycle."""


HOME = str(Path.home())
WORKSPACE = Path(os.getenv('BH_AGENT_WORKSPACE', 'workspace')).resolve()

class InjectionTraceWriter:
    """Instrument Hermes runtime loop at each decision point."""
    
    def __init__(self, log_file: Path):
        self.log_lines: List[str] = []
        self.trace_data: Dict[str, Any] = {}
        
    def log_model_decision(self, cycle_num: int) -> None:
        """Record when model considers next action."""
        line = f"[{cycle_num}] MODEL DECISION POINT — considering whether to invoke tool"
        self.log_lines.append(line)
        
    def log_tool_dispatch(self, tool_name: str, call_args: Optional[Dict] = None) -> None:
        """Record tool dispatch and extraction."""
        line = f"[{tool_name}] TO DISPATCH ({', '.join(call_args.keys()) if call_args else '(no args)'})"
        self.log_lines.append(line)
        
    def log_tool_result(self, success: bool, context_bytes: int) -> None:
        """Record tool result handling."""
        status = "✓ OK" if success else f"✗ FAILED({err})"
        line = f"[{tool_name}] RESULT {status} — processed {context_bytes} bytes of output"
        self.log_lines.append(line)
        
    def log_compression_start(self, threshold: int = 4096) -> None:
        """Record entry into compression pipeline."""
        line = f"[COMPRESSION] Entering compressor pipeline with threshold={threshold}"
        self.log_lines.append(line)
        
    def log_compression_done(self, compressed_bytes: int) -> None:
        """Record compression completion."""
        line = f"[COMP DONE] Compressed window from {compressed_bytes} bytes"
        self.log_lines.append(line)
        
    def log_housekeeping_done(self, garbage_collected: bool) -> None:
        """Record housekeeping completion."""
        status = "garbage collected" if garbage_collected else "no collection needed"
        line = f"[HOUSEKEEP ING] Done — {status}"
        self.log_lines.append(line)
        
    def log_end_turn(self, reason: str, continues_next: bool) -> None:
        """Record end_turn decision and continuation flag."""
        status = "CONTINUES LOOP" if continues_next else "TERMINATES"
        line = f"[END TURN] Reason='{reason}' — {status}"
        self.log_lines.append(line)
        
        if not continues_next:
            # This is a continuous defect if no continuation was scheduled
            line += " [CONTINUATION DEFECT DETECTED]"
            self.log_lines.append(line)
            
    def write_trace(self, path: Path) -> None:
        """Append trace to the log file."""
        with open(path, 'a') as f:
            for line in self.log_lines:
                f.write(line + '\n')
                
            
    def export_trace(self) -> str:
        """Return current trace as JSON-serializable string."""
        return json.dumps({
            'log_lines': self.log_lines,
        }, indent=2)


def run_continuation_injection_test() -> Dict[str, Any]:
    """Run a multi-cycle test with visible instrumentation."""
    
    workspace_dir = Path(WORKSPACE).resolve()
    agent_log_dir = workspace_dir / '.hermes' / 'continuity'
    agent_log_dir.mkdir(parents=True, exist_ok=True)
    
    log_file = agent_log_dir / 'injection_trace.txt'
    
    writer = InjectionTraceWriter(log_file)
    
    # Cycle 1: Read types.ts (large file, triggers compression)
    writer.log_model_decision(1)
    writer.log_tool_dispatch('read_file', {'path': '/types.ts'})
    subprocess.run(f'cd /d/AgenticOS/server && {fileAPath}, check=False, capture_output=True, text=True)
    
    # Cycle 2: Read store.ts  
    writer.log_model_decision(2)
    writer.log_tool_dispatch('read_file', {'path': '/store.ts'})
    
    try:
        branch_out = subprocess.check_output(command=b'cd /d/AgenticOS/server && git rev-parse --abbrev-ref HEAD', shell=True, capture_output=True, text=True)
        
    # Cycle 3: Write marker
    writer.log_model_decision(3)
    writer.log_tool_dispatch('write_file', {'path': '/marker.txt'})
    
    Path('/d/AgenticOS/src/temp-continuity-marker.txt').write_text('CONTINUITY_TEST_MARKER')
    
    # Cycle 4: Re-read marker
    writer.log_model_decision(4)
    writer.log_tool_dispatch('read_file', {'path': '/marker.txt'})
    
    # Generate trace
    trace = writer.export_trace()
    
    return {
        'trace_lines': len(writer.log_lines),
        'traces_written': True,
    }


if __name__ == '__main__':
    import json
    
    print("# Continuation Injection Test")
    print(run_continuation_injection_test())
