# Planning Workflow Rule

**Priority**: HIGH | **Applies to**: All agents

---

## Purpose

Define the standard workflow for task planning, self-criticism, and task tracking using think, criticize, and todo tools.

---

## Mandatory Planning Workflow

**EVERY agent MUST follow this 5-step workflow:**

### Step 1: Think (Plan Development)

**BEFORE starting any task**, use `think` tool to:
1. Understand the user's request
2. Identify all required actions
3. Determine dependencies between actions
4. Estimate complexity and time
5. Consider potential issues/risks

**Think format**:
```
## Analysis
[Your understanding of the task]

## Required Actions
- [ ] Action 1
- [ ] Action 2
- [ ] Action 3

## Dependencies
- Action 2 depends on Action 1
- Action 3 depends on Action 2

## Estimated Time
- Action 1: 5 minutes
- Action 2: 10 minutes
- Action 3: 15 minutes

## Potential Issues
- Issue 1: Description
- Issue 2: Description
```

---

### Step 2: Criticize (Self-Correction)

**IMMEDIATELY after planning**, use `criticize` tool to:
1. Review the plan for completeness
2. Identify gaps or missing steps
3. Check for logical errors
4. Verify all constraints are considered
5. Assess if the plan is realistic

**Criticize format**:
```
## Strengths
- Strength 1
- Strength 2

## Weaknesses
- Weakness 1: How to fix
- Weakness 2: How to fix

## Missing Elements
- Missing element 1: Impact and solution
- Missing element 2: Impact and solution

## Improved Plan
[Refined plan based on criticism]
```

---

### Step 3: Create Todo List

**AFTER criticism and plan refinement**, use `todowrite` tool to create a todo list. 
Если нет доступа к инсрументу то пропусти этот шаг.

---

## Best Practices

### Planning (Think)

✅ **DO**:
- Be thorough and consider all edge cases
- Estimate realistic timeframes
- Identify dependencies clearly
- Think about potential issues

❌ **DON'T**:
- Skip thinking phase
- Create overly vague plans
- Ignore dependencies
- Be overly optimistic about time

### Criticizing (Criticize)

✅ **DO**:
- Be honest about weaknesses
- Identify missing elements
- Provide specific improvements
- Update the plan based on criticism

❌ **DON'T**:
- Skip criticism phase
- Be overly negative without solutions
- Ignore valid points in the plan

### Todo Management

✅ **DO**:
- Update status immediately after each task
- Use clear, specific task descriptions
- Set appropriate priorities
- Complete ALL tasks before stopping

❌ **DON'T**:
- Forget to update status
- Leave tasks hanging (in_progress) when completed
- Stop before completing all todos
- Use vague task descriptions

---

## Validation Checklist

Before starting any task:
- [ ] Used `think` tool to create initial plan
- [ ] Used `criticize` tool to review plan
- [ ] Used `todowrite` tool to create todo list
- [ ] All tasks have clear descriptions
- [ ] All tasks have appropriate priorities

During task execution:
- [ ] Marked task as `in_progress` before starting
- [ ] Updated todo to `completed` after finishing
- [ ] Updated todo after EACH task completion

After task completion:
- [ ] ALL tasks marked as `completed`
- [ ] No tasks left in `pending` or `in_progress`
- [ ] Final summary provided to user

---

## Why This Workflow Matters

### Benefits

1. **Improved quality**: Planning + criticism = better solutions
2. **Transparency**: User sees exactly what you're doing
3. **Consistency**: Always follow the same structured approach
4. **Reliability**: Don't forget tasks or stop prematurely
5. **Error reduction**: Catch issues before implementation

### Performance Impact

Research shows:
- **Planning first**: +30% task success rate
- **Self-criticism**: +25% solution quality
- **Task tracking**: +40% completion rate
- **Combined**: ~2x improvement in task delivery

---

## Failure Modes

**NOT following this workflow** results in:
- Incomplete solutions (forgot tasks)
- Poor quality plans (no criticism)
- User frustration (unclear what's happening)
- Lost tasks (no tracking)
- Premature stopping (didn't complete all todos)

**ALWAYS use the 5-step workflow for best results.**
