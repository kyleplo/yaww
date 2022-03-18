var tests = {}

function createTest(n, c){
  tests[n] = {
    name: n,
    status: "running",
    startTime: Date.now(),
    runTime: 0,
    error: "",
    count: 0,
    countGoal: c || 1,
    timeout: -1
  }
}

function assert(n, t, e){
  if(tests[n].status !== "running"){
    return;
  }

  if(t){
    tests[n].count = Math.min(tests[n].count + 1, tests[n].countGoal);
    if(tests[n].count >= tests[n].countGoal){
      tests[n].status = "success";
      clearTimeout(tests[n].timeout);
    }
  }else{
    tests[n].status = "failed";
    tests[n].error = e;
  }
  testTick();
}

function assertFuture(n, t, e){
  if(tests[n].status !== "running" || tests[n].timeout){
    return;
  }

  tests[n].timeout = setTimeout(() => {
    tests[n].status = "failed";
    tests[n].error = e;
    testTick();
  }, t);
}

function testTick(){
  const testContainer = document.querySelector("#testContainer");
  testContainer.innerHTML = "";

  const header = document.createElement("TR");
  header.innerHTML = `
    <th>Name</th>
    <th>Count</th>
    <th>Run Time</th>
    <th>Error</th>
  `;
  testContainer.append(header);

  var running = 0;
  var failed = 0;
  var success = 0;
  Object.keys(tests).forEach(t => {
    if(tests[t].status === "running"){
      tests[t].runTime = Date.now() - tests[t].startTime;
    }

    const row = document.createElement("TR");
    
    const name = document.createElement("TD");
    name.textContent = tests[t].name;
    row.append(name);

    const count = document.createElement("TD");
    count.textContent = tests[t].count + "/" + tests[t].countGoal;
    row.append(count);

    const runTime = document.createElement("TD");
    runTime.textContent = Math.round(tests[t].runTime / 1000);
    row.append(runTime);

    const error = document.createElement("TD");
    error.textContent = tests[t].error;
    row.append(error);

    testContainer.append(row);

    row.style.backgroundColor = (tests[t].status === "success" ? "#aaffaa" : (tests[t].status === "failed" ? "#ffbbbb" : "#ffffff"));

    if(tests[t].status === "success"){
      success++;
    }else if(tests[t].status === "failed"){
      failed++;
    }else{
      running++;
    }
  });

  document.querySelector("#testSummary").innerText = `${running} tests running, ${success} (${Math.round(success / Object.keys(tests).length * 100)}%) successful, ${failed} (${Math.round(failed / Object.keys(tests).length * 100)}%) failed.`
}

setInterval(testTick, 1000);