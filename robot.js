// vertex shader program
var VSHADER_SOURCE =
	'attribute vec4 a_Position;\n' +
	'attribute vec4 a_Normal;\n' +
	'uniform mat4 u_ModelMatrix;\n' +
	'uniform mat4 u_TransformationMatrix;' +
	'uniform mat4 u_NormalMatrix;\n' +
	'uniform vec4 u_Color;\n' +
	'varying vec4 v_Color;\n' +
	'varying vec3 v_Normal;\n' +
	'varying vec3 v_Position;\n' +
	'void main()\n' +
	'{\n' +
	'	gl_Position = u_TransformationMatrix * a_Position;\n' +		// position of a vertex after applying projection and model matrices
	'	v_Position = vec3(u_ModelMatrix * a_Position);\n' +		// position of a vertex after applying a model matrix (because of point light)
	'	v_Normal = normalize(vec3(u_NormalMatrix * a_Normal));\n' +		// normal vector of a vertex
	'	v_Color = u_Color;\n' +		// color of a vertex
 	'}\n';

// fragment shader program
var FSHADER_SOURCE =
	'precision mediump float;\n' +
	'uniform vec3 u_LightColor;\n' +
	'uniform vec3 u_LightPosition;\n' +
	'uniform vec3 u_AmbientLight;\n' +
	'varying vec4 v_Color;\n' +
	'varying vec3 v_Normal;\n' +
	'varying vec3 v_Position;\n' +
	'void main()\n' +
	'{\n' +
	'	vec3 normal = normalize(v_Normal);\n' +		// normal vector has length 1.0 now
	'	vec3 lightDirection = normalize(u_LightPosition - v_Position);\n' +		// direction from the light source to the fragment
	'	float nDotL = max(dot(lightDirection, normal), 0.0);\n' +	// angle between the light direction and the fragment normal (changed to 0.0 when negative)
	'	vec3 diffuse = u_LightColor * v_Color.rgb * nDotL;\n' +		// point light intensity based on diffuse reflection
	'	vec3 ambient = u_AmbientLight * v_Color.rgb;\n' +		// ambient light intesity
	'	gl_FragColor = vec4(diffuse + ambient, v_Color.a);\n' +		// resulting color of a fragment
	'}\n';

// size of the rotation performed per one key press
var ANGLE_STEP = 5.0;

// the speed of limb rotation when moving
var LIMB_MOVEMENT_SPEED = 0.5;

// maximum angle of limb rotation when moving
var LIMB_MAX_ANGLE = 40;

// angle between arms and body of the robot
var ARM_BODY_ANGLE = 20;

// the speed of robot movement
var ROBOT_MOVEMENT_SPEED = 0.2;

// maximum vertical eccentricity of the robot while walking
var MAX_VERTICAL_ECCENTRICITY = 0.5;

// the boundary sizes of the robot
var ROBOT_MAX_SIZE = 2.0;
var ROBOT_MIN_SIZE = 0.1;

// orientation of the robot [rotation around x, rotation around y]
var g_robotOrientation = [0.0, 0.0];

// position of the robot [along x (left/right), along y (up/down), along z (forward/backward)]
var g_robotPosition = [0.0, 0.0, 0.0];

// the direction of robot movement
var g_robotForward = true;

// angles of robot's limbs and their movement
var g_leftLegRotation = 0.0;
var g_leftLegForward = false;

var g_rightLegRotation = 0.0;
var g_rightLegForward = true;

var g_leftArmRotation = 0.0;
var g_leftArmForward = true;

var g_rightArmRotation = 0.0;
var g_rightArmForward = false;

// slight vertical movement caused by walking (the notion of 'vertical' changes with the rotation of the robot)
var g_robotVerticalEccentricity = 0.0;
var g_robotVerticalEccentricityDirection = [0.0, 0.0, 0.0];

// the size of the robot (1.0 is normal)
var g_robotSize = 1.0;

// stack for transformation matrices used in hierarchical animations
var g_matrixStack = [];

// transformation matrices used in hierarchical animations
var g_modelMatrix = new Matrix4();
var g_normalMatrix = new Matrix4();
var g_transformationMatrix = new Matrix4();

// color of a part of the robot (box)
var g_color = new Float32Array(4);

// map of pressed keys for updating robot rotation, movement and limb rotation (allows for multiple actions at the same time)
var g_keysPressed = {
		37: false, 39: false, 38: false, 40: false
	};

// mouse input for updating robot size and orientation
var g_mouseDragDelta = [0.0, 0.0];
var g_mouseWheelDelta = 0.0;

function main()
{
	// get <canvas> element
	var canvas = document.getElementById('webgl');

	// get WebGL context for that element
	var gl = getWebGLContext(canvas);
	if (!gl)
	{
		console.log('Failed to get the rendering context for WebGL.');
		return;
	}
	
	// initialize shaders
	if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE))
	{
		console.log('Failed to initialize shaders.');
		return;
	}

	// set clear color and enable hidden surface removal
	gl.clearColor(0.0, 0.0, 0.0, 1);
	gl.enable(gl.DEPTH_TEST);

	// get the storage location of shader variables
	var u_ModelMatrixLocation = gl.getUniformLocation(gl.program, 'u_ModelMatrix');
	var u_TransformationMatrixLocation = gl.getUniformLocation(gl.program, 'u_TransformationMatrix');
	var u_NormalMatrixLocation = gl.getUniformLocation(gl.program, 'u_NormalMatrix');
	var u_LightColorLocation = gl.getUniformLocation(gl.program, 'u_LightColor');
	var u_LightPositionLocation = gl.getUniformLocation(gl.program, 'u_LightPosition');
	var u_AmbientLightLocation = gl.getUniformLocation(gl.program, 'u_AmbientLight');
	var u_ColorLocation = gl.getUniformLocation(gl.program, 'u_Color');
	if (u_ModelMatrixLocation == null || u_TransformationMatrixLocation == null
		|| u_LightColorLocation == null || u_LightPositionLocation == null
		|| u_AmbientLightLocation == null || u_NormalMatrixLocation == null
		|| u_ColorLocation == null)
	{
		console.log('Failed to get the storage location of shader variables.');
		return;
	}

	// set the light color
	gl.uniform3f(u_LightColorLocation, 1.0, 1.0, 1.0);

	// set the light position
	gl.uniform3f(u_LightPositionLocation, -2.0, 2.0, 2.0);

	// set the ambient light
	gl.uniform3f(u_AmbientLightLocation, 0.2, 0.2, 0.2);

	// set the eye point and the viewing volume
	var viewProjectionMatrix = new Matrix4();
	viewProjectionMatrix.setPerspective(50.0, canvas.width / canvas.height, 1.0, 100.0);
	viewProjectionMatrix.lookAt(0.0, 1.4, 10.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0);

	// set the vertex information
	var n = initVertexBuffers(gl);
	if (n < 0)
	{
		console.log('Failed to set vertex information.')
		return;
	}

	// register the event handlers
	initEventHandlers(canvas);

	var tick = function() {

		// update robot position, orientation and limb rotation according to keys pressed
		updateRobot();

		// draw the robot by modifying the cube data stored in the vertex buffer
		draw(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);

		// request a new frame (update) from the browser
		requestAnimationFrame(tick, canvas);
	};
	
	tick();	
}

function initVertexBuffers(gl)
{
	// create a cube
  	//    v6----- v5
  	//   /|      /|
  	//  v1------v0|
  	//  | |     | |
  	//  | |v7---|-|v4
  	//  |/      |/
  	//  v2------v3
	var vertices = new Float32Array([
		1.0, 1.0, 1.0,  -1.0, 1.0, 1.0,  -1.0,-1.0, 1.0,   1.0,-1.0, 1.0, // v0-v1-v2-v3 front
		1.0, 1.0, 1.0,   1.0,-1.0, 1.0,   1.0,-1.0,-1.0,   1.0, 1.0,-1.0, // v0-v3-v4-v5 right
	    1.0, 1.0, 1.0,   1.0, 1.0,-1.0,  -1.0, 1.0,-1.0,  -1.0, 1.0, 1.0, // v0-v5-v6-v1 up
	   -1.0, 1.0, 1.0,  -1.0, 1.0,-1.0,  -1.0,-1.0,-1.0,  -1.0,-1.0, 1.0, // v1-v6-v7-v2 left
	   -1.0,-1.0,-1.0,   1.0,-1.0,-1.0,   1.0,-1.0, 1.0,  -1.0,-1.0, 1.0, // v7-v4-v3-v2 down
	    1.0,-1.0,-1.0,  -1.0,-1.0,-1.0,  -1.0, 1.0,-1.0,   1.0, 1.0,-1.0  // v4-v7-v6-v5 back
 	]);

	var normals = new Float32Array([
		0.0, 0.0, 1.0,   0.0, 0.0, 1.0,   0.0, 0.0, 1.0,   0.0, 0.0, 1.0,  // v0-v1-v2-v3 front
		1.0, 0.0, 0.0,   1.0, 0.0, 0.0,   1.0, 0.0, 0.0,   1.0, 0.0, 0.0,  // v0-v3-v4-v5 right
		0.0, 1.0, 0.0,   0.0, 1.0, 0.0,   0.0, 1.0, 0.0,   0.0, 1.0, 0.0,  // v0-v5-v6-v1 up
	   -1.0, 0.0, 0.0,  -1.0, 0.0, 0.0,  -1.0, 0.0, 0.0,  -1.0, 0.0, 0.0,  // v1-v6-v7-v2 left
		0.0,-1.0, 0.0,   0.0,-1.0, 0.0,   0.0,-1.0, 0.0,   0.0,-1.0, 0.0,  // v7-v4-v3-v2 down
		0.0, 0.0,-1.0,   0.0, 0.0,-1.0,   0.0, 0.0,-1.0,   0.0, 0.0,-1.0   // v4-v7-v6-v5 back
	]);

	var indices = new Uint8Array([
		0, 1, 2,   0, 2, 3,    	// front
	    4, 5, 6,   4, 6, 7,    	// right
	    8, 9,10,   8,10,11,    	// up
	   	12,13,14,  12,14,15,    // left
	   	16,17,18,  16,18,19,    // down
	   	20,21,22,  20,22,23     // back
	]);

	// write the vertex coordinates and normals to buffer objects
	if (!initArrayBuffer(gl, vertices, 3, gl.FLOAT, 'a_Position'))
		return -1;
	if (!initArrayBuffer(gl, normals, 3, gl.FLOAT, 'a_Normal'))
		return -1;

	// create an index buffer object
	var indexBuffer = gl.createBuffer();
	if (!indexBuffer)
	{
		console.log('Failed to create a buffer object.');
		return -1;
	}

	// write the indices to the buffer object
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

	return indices.length;
}

function initArrayBuffer(gl, data, num, type, attribute)
{
	var buffer = gl.createBuffer();
	if (!buffer)
	{
		console.log('Failed to create a buffer object.');
		return false;
	}

	// write data into the buffer object
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

	// assign the buffer object to the attribute variable
	var a_attributeLocation = gl.getAttribLocation(gl.program, attribute);
	if (a_attributeLocation < 0)
	{
		console.log('Failed to get the storage location of shader variables.');
		return;
	}
	gl.vertexAttribPointer(a_attributeLocation, num, type, false, 0, 0);

	// enable the assignment of the buffer object to the attribute variable
	gl.enableVertexAttribArray(a_attributeLocation);

	return true;
}

function initEventHandlers(canvas)
{
	var dragging = false;
	var lastX = -1;
	var lastY = -1;

	// key has been pressed
	document.onkeydown = function(ev) {

		// remember if a relevant key is pressed
		if (ev.keyCode in g_keysPressed)
		{
			g_keysPressed[ev.keyCode] = true;
		}
	};

	// key has been released
	document.onkeyup = function(ev) {

		// remember if a relevant key has been released
		if (ev.keyCode in g_keysPressed)
		{
			g_keysPressed[ev.keyCode] = false;
		}
	};

	// mouse has been pressed
	canvas.onmousedown = function(ev) {

		// mouse window coordinates
		var x = ev.clientX;
		var y = ev.clientY;

		// make sure mouse is in <canvas> and if it is, start dragging
		var rect = ev.target.getBoundingClientRect();
		if (rect.left <= x && x < rect.right && rect.top <= y && y < rect.bottom)
		{
			lastX = x;
			lastY = y;
			dragging = true;
		}
	};

	// mouse has been released
	canvas.onmouseup = function(ev) {

		// stop dragging
		dragging = false;
		g_mouseDragDelta = [0.0, 0.0];
	};

	// mouse has been moved
	canvas.onmousemove = function(ev) {

		// mouse window coordinates
		var x = ev.clientX;
		var y = ev.clientY;

		if (dragging)
		{
			// how much has the mouse moved
			g_mouseDragDelta[0] = x - lastX;
			g_mouseDragDelta[1] = y - lastY;
		}

		lastX = x;
		lastY = y;
	};

	// mouse wheel has been scrolled
	canvas.onmousewheel = function(ev) {

		// how much has the wheel scrolled (with a factor for slower size change)
		g_mouseWheelDelta = 0.001 * ev.wheelDelta;
	};
}

function updateRobot()
{
	// MOUSE WHEEL SCROLLING -> SIZE CHANGE
	if (g_robotSize + g_mouseWheelDelta < ROBOT_MIN_SIZE)
	{
		g_robotSize = ROBOT_MIN_SIZE;
	}
	else if (g_robotSize + g_mouseWheelDelta > ROBOT_MAX_SIZE)
	{
		g_robotSize = ROBOT_MAX_SIZE;
	}
	else
	{
		g_robotSize = g_robotSize += g_mouseWheelDelta;
	}

	// reset before another mouse wheel event
	g_mouseWheelDelta = 0;

	// MOUSE DRAGGING -> ROBOT ORIENTATION
	// change the orientation of the robot (mouse movement along the x axis means robot rotation around the y axis!)
	g_robotOrientation[0] = (g_robotOrientation[0] + g_mouseDragDelta[1]) % 360;
	g_robotOrientation[1] = (g_robotOrientation[1] + g_mouseDragDelta[0]) % 360;

	// KEY PRESSES -> MOVEMENT	
	// 'right arrow' key -> ROTATE THE ROBOT TO THE LEFT
	if (g_keysPressed[39])
		g_robotOrientation[1] = (g_robotOrientation[1] - LIMB_MOVEMENT_SPEED * ANGLE_STEP) % 360;
	
	// 'left arrow' key -> ROTATE THE ROBOT TO THE RIGHT
	if (g_keysPressed[37])
		g_robotOrientation[1] = (g_robotOrientation[1] + LIMB_MOVEMENT_SPEED * ANGLE_STEP) % 360;
	
	// 'up arrow' key -> MOVE THE ROBOT FORWARD
	if (g_keysPressed[38])
	{
		// matrix to change the orientation of the floor according to robot's orientation
		// (the floor is always perpendicular to robot's feet)
		var baseChangeMatrix = new Matrix4();
		baseChangeMatrix.setRotate(g_robotOrientation[0], 1.0, 0.0, 0.0);
		baseChangeMatrix.rotate(g_robotOrientation[1], 0.0, 1.0, 0.0);

		// the initial direction of the robot is (0, 0, 1) -> work with this vector when moving forward
		var movementVector = baseChangeMatrix.multiplyVector3(new Vector3([0.0, 0.0, 1.0]));

		// smaller robot moves slower
		g_robotPosition[0] += ROBOT_MOVEMENT_SPEED * g_robotSize * movementVector.elements[0];
		g_robotPosition[1] += ROBOT_MOVEMENT_SPEED * g_robotSize * movementVector.elements[1];
		g_robotPosition[2] += ROBOT_MOVEMENT_SPEED * g_robotSize * movementVector.elements[2];

		// change animation if direction changed
		if (!g_robotForward)
		{
			g_leftLegForward = !g_leftLegForward;
			g_rightLegForward = !g_rightLegForward;
			g_leftArmForward = !g_leftArmForward;
			g_rightArmForward = !g_rightArmForward;
			g_robotForward = !g_robotForward;
		}

		// leg animation
		legMovement();

		// arm animation
		armMovement();

		// body animation
		bodyMovement(baseChangeMatrix);
	}
	
	// 'down arrow' key -> MOVE THE ROBOT BACKWARD
	if (g_keysPressed[40])
	{
		// matrix to change the orientation of the floor according to robot's orientation
		// (the floor is always perpendicular to robot's feet)
		var baseChangeMatrix = new Matrix4();
		baseChangeMatrix.setRotate(g_robotOrientation[0], 1.0, 0.0, 0.0);
		baseChangeMatrix.rotate(g_robotOrientation[1], 0.0, 1.0, 0.0);

		// the initial direction of the robot is (0, 0, 1) -> work with this vector when moving forward
		var movementVector = baseChangeMatrix.multiplyVector3(new Vector3([0.0, 0.0, 1.0]));

		// smaller robot moves slower
		g_robotPosition[0] -= ROBOT_MOVEMENT_SPEED * g_robotSize * movementVector.elements[0];
		g_robotPosition[1] -= ROBOT_MOVEMENT_SPEED * g_robotSize * movementVector.elements[1];
		g_robotPosition[2] -= ROBOT_MOVEMENT_SPEED * g_robotSize * movementVector.elements[2];

		// change animation if direction changed
		if (g_robotForward)
		{
			g_leftLegForward = !g_leftLegForward;
			g_rightLegForward = !g_rightLegForward;
			g_leftArmForward = !g_leftArmForward;
			g_rightArmForward = !g_rightArmForward;
			g_robotForward = !g_robotForward;
		}

		// leg animation
		legMovement();

		// arm animation
		armMovement();

		// body animation
		bodyMovement(baseChangeMatrix);
	}

	// robot is not moving
	if (!g_keysPressed[38] && !g_keysPressed[40])
	{
		g_leftLegRotation = 0.0;
		g_rightLegRotation = 0.0;

		g_leftArmRotation = 0.0;
		g_rightArmRotation = 0.0;

		g_rightLegForward = true;
		g_leftLegForward = false;

		g_leftArmForward = true;
		g_rightArmForward = false;

		// return body to idle position
		g_robotVerticalEccentricity = 0.0;
		g_robotVerticalEccentricityDirection = [0.0, 0.0, 0.0];
	}
}

function legMovement()
{
	// if left leg is moving forward, leg angle is getting bigger and bigger
	// until it hits the maximum angle and then it goes back
	if (g_leftLegForward)
	{
		if (g_leftLegRotation < LIMB_MAX_ANGLE)
			g_leftLegRotation += LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_leftLegForward = false;
	}
		
	if (!g_leftLegForward)
	{
		if (g_leftLegRotation > -LIMB_MAX_ANGLE)
			g_leftLegRotation -= LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_leftLegForward = true;
	}
	
	if (g_rightLegForward)
	{
		if (g_rightLegRotation < LIMB_MAX_ANGLE)
			g_rightLegRotation += LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_rightLegForward = false;
	}

	if (!g_rightLegForward)
	{
		if (g_rightLegRotation > -LIMB_MAX_ANGLE)
			g_rightLegRotation -= LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_rightLegForward = true;
	}
}

function armMovement()
{
	// if left arm is moving forward, arm angle is getting bigger and bigger
	// until it hits the maximum angle and then it goes back
	if (g_leftArmForward)
	{
		if (g_leftArmRotation < LIMB_MAX_ANGLE)
			g_leftArmRotation += LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_leftArmForward = false;
	}
	
	if (!g_leftArmForward)
	{
		if (g_leftArmRotation > -LIMB_MAX_ANGLE)
			g_leftArmRotation -= LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_leftArmForward = true;
	}
		
	if (g_rightArmForward)
	{
		if (g_rightArmRotation < LIMB_MAX_ANGLE)
			g_rightArmRotation += LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_rightArmForward = false;
	}

	if (!g_rightArmForward)
	{
		if (g_rightArmRotation > -LIMB_MAX_ANGLE)
			g_rightArmRotation -= LIMB_MOVEMENT_SPEED * ANGLE_STEP;
		else
			g_rightArmForward = true;
	}
}

function bodyMovement(baseChangeMatrix)
{
	// if legs are aligned, eccentricity is at its highest, if legs are apart, eccentricity is at its lowest
	if ((g_leftLegForward && g_leftLegRotation > 0) || (!g_leftLegForward && g_leftLegRotation < 0))
	{
		// eccentricity is changing by the same number of steps as the leg angle up until its maximum value
		g_robotVerticalEccentricity -= (MAX_VERTICAL_ECCENTRICITY * g_robotSize) / (LIMB_MAX_ANGLE / (ANGLE_STEP * LIMB_MOVEMENT_SPEED));
	}
	else if ((!g_leftLegForward && g_leftLegRotation > 0) || (g_leftLegForward && g_leftLegRotation < 0))
	{
		g_robotVerticalEccentricity += (MAX_VERTICAL_ECCENTRICITY * g_robotSize) / (LIMB_MAX_ANGLE / (ANGLE_STEP * LIMB_MOVEMENT_SPEED));
	}

	// compute vertical direction according to robot's orientation (the norm of the result is 1)
	var verticalDirection = baseChangeMatrix.multiplyVector3(new Vector3([0.0, 1.0, 0.0]));

	// set the eccentricity vector and change its length to g_robotVerticalEccentricity
	g_robotVerticalEccentricityDirection[0] = g_robotVerticalEccentricity * verticalDirection.elements[0];
	g_robotVerticalEccentricityDirection[1] = g_robotVerticalEccentricity * verticalDirection.elements[1];
	g_robotVerticalEccentricityDirection[2] = g_robotVerticalEccentricity * verticalDirection.elements[2];
}

function draw(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation)
{
	// cube dimension
	var cubeHeight = 2.0;

	// robot dimensions
	var bodyHeight = 2 * g_robotSize;
	
	var headHeight = bodyHeight/3;
	var headWidth = bodyHeight/2;
	
	var legHeight = bodyHeight;
	var legWidth = bodyHeight/4;
	
	var footHeight = bodyHeight/10;
	var footWidth = bodyHeight/3;
	var footDepth = bodyHeight/2;
	
	var armHeight = bodyHeight/1.5;
	var armWidth = bodyHeight/4;
	
	var handHeight = bodyHeight/3;
	
	// clear color and depth buffer
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	// move and rotate the whole robot
	g_modelMatrix.setTranslate(
		g_robotPosition[0] + g_robotVerticalEccentricityDirection[0],
		g_robotPosition[1] + g_robotVerticalEccentricityDirection[1],
		g_robotPosition[2] + g_robotVerticalEccentricityDirection[2]
	);
	g_modelMatrix.rotate(g_robotOrientation[0], 1.0, 0.0, 0.0);
	g_modelMatrix.rotate(g_robotOrientation[1], 0.0, 1.0, 0.0);
	

	// body (P1)
	pushMatrix(g_modelMatrix);
		g_modelMatrix.scale(bodyHeight/cubeHeight, bodyHeight/cubeHeight, bodyHeight/cubeHeight);
		g_color = [1.0, 0.0, 0.0, 1.0];
		drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
	g_modelMatrix = popMatrix();
	
	// head (P2)
	pushMatrix(g_modelMatrix);
		g_modelMatrix.translate(0.0, bodyHeight/2 + headHeight/2, 0.0);
		g_modelMatrix.scale(headWidth/cubeHeight, headHeight/cubeHeight, headWidth/cubeHeight);
		g_color = [0.0, 1.0, 0.0, 1.0];
		drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
	g_modelMatrix = popMatrix();

	// left leg (P7)
	pushMatrix(g_modelMatrix);
		g_modelMatrix.translate(-bodyHeight/4, -legHeight/2, 0.0);
		g_modelMatrix.rotate(g_leftLegRotation, 1.0, 0.0, 0.0);
		g_modelMatrix.translate(0.0, -legHeight/2, 0.0);

		pushMatrix(g_modelMatrix);	
			g_modelMatrix.scale(legWidth/cubeHeight, legHeight/cubeHeight, legWidth/cubeHeight);
			g_color = [0.0, 0.0, 1.0, 1.0];
			drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
		g_modelMatrix = popMatrix();

		// left foot (P8)
		g_modelMatrix.translate(0.0, -(legHeight/2 + footHeight/2), footDepth/2 - legWidth/2);
		g_modelMatrix.scale(footWidth/cubeHeight, footHeight/cubeHeight, footDepth/cubeHeight);
		g_color = [1.0, 1.0, 0.0, 1.0];
		drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
	g_modelMatrix = popMatrix();

	// right leg (P9)
	pushMatrix(g_modelMatrix);
		g_modelMatrix.translate(bodyHeight/4, -legHeight/2, 0.0);
		g_modelMatrix.rotate(g_rightLegRotation, 1.0, 0.0, 0.0);
		g_modelMatrix.translate(0.0, -legHeight/2, 0.0);
		
		pushMatrix(g_modelMatrix);
			g_modelMatrix.scale(legWidth/cubeHeight, legHeight/cubeHeight, legWidth/cubeHeight);
			g_color = [1.0, 0.0, 1.0, 1.0];
			drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
		g_modelMatrix = popMatrix();
		
		// right foot (P10)
		g_modelMatrix.translate(0.0, -(legHeight/2 + footHeight/2), footDepth/2 - legWidth/2);
		g_modelMatrix.scale(footWidth/cubeHeight, footHeight/cubeHeight, footDepth/cubeHeight);
		g_color = [0.0, 1.0, 1.0, 1.0];
		drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
	g_modelMatrix = popMatrix();

	// left arm (P3)
	pushMatrix(g_modelMatrix);
		g_modelMatrix.translate(-(bodyHeight/2), armHeight/2, 0.0);
		g_modelMatrix.rotate(g_leftArmRotation, 1.0, 0.0, 0.0);
		g_modelMatrix.rotate(-ARM_BODY_ANGLE, 0.0, 0.0, 1.0);
		g_modelMatrix.translate(0.0, -armHeight/2, 0.0);
		
		pushMatrix(g_modelMatrix);
			g_modelMatrix.scale(armWidth/cubeHeight, armHeight/cubeHeight, armWidth/cubeHeight);
			g_color = [0.2, 0.4, 0.8, 1.0];
			drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
		g_modelMatrix = popMatrix();
		
		// left hand (P4)
		g_modelMatrix.translate(0.0, -armHeight/2, 0.0);
		g_modelMatrix.scale(handHeight/cubeHeight, handHeight/cubeHeight, handHeight/cubeHeight);
		g_color = [0.8, 0.4, 0.2, 1.0];
		drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
	g_modelMatrix = popMatrix();

	// right arm (P5)
	pushMatrix(g_modelMatrix);
		g_modelMatrix.translate(bodyHeight/2, armHeight/2, 0.0);
		g_modelMatrix.rotate(g_rightArmRotation, 1.0, 0.0, 0.0);
		g_modelMatrix.rotate(ARM_BODY_ANGLE, 0.0, 0.0, 1.0);
		g_modelMatrix.translate(0.0, -armHeight/2, 0.0);
		
		pushMatrix(g_modelMatrix);
			g_modelMatrix.scale(armWidth/cubeHeight, armHeight/cubeHeight, armWidth/cubeHeight);
			g_color = [0.3, 0.6, 0.3, 1.0];
			drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
		g_modelMatrix = popMatrix();
		
		// right hand (P6)
		g_modelMatrix.translate(0.0, -armHeight/2, 0.0);
		g_modelMatrix.scale(handHeight/cubeHeight, handHeight/cubeHeight, handHeight/cubeHeight);
		g_color = [0.6, 0.3, 0.6, 1.0];
		drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation);
	g_modelMatrix = popMatrix();
}

function drawBox(gl, n, viewProjectionMatrix, u_ModelMatrixLocation, u_TransformationMatrixLocation, u_NormalMatrixLocation, u_ColorLocation)
{
	// assign model matrix to a shader variable
	gl.uniformMatrix4fv(u_ModelMatrixLocation, false, g_modelMatrix.elements);

	// combine a model matrix and a view and projection matrix into a transformation matrix
	// assign it to a shader variable
	g_transformationMatrix.set(viewProjectionMatrix);
	g_transformationMatrix.multiply(g_modelMatrix);
	gl.uniformMatrix4fv(u_TransformationMatrixLocation, false, g_transformationMatrix.elements);

	// compute normal matrix and assign it to a shader variable
	g_normalMatrix.setInverseOf(g_modelMatrix);
	g_normalMatrix.transpose();
	gl.uniformMatrix4fv(u_NormalMatrixLocation, false, g_normalMatrix.elements);

	gl.uniform4fv(u_ColorLocation, g_color);

	// draw a box
	gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_BYTE, 0);
}

// matrix stack operations
function pushMatrix(matrix)
{
	var matrix2 = new Matrix4(matrix);
	g_matrixStack.push(matrix2);
}

function popMatrix()
{
	return g_matrixStack.pop();
}