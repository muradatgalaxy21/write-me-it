@echo off
rem Setup and run script for the frontend and backend of the write-me-it project.

rem 1. Check and copy frontend environment configuration.
rem - Checks if the file .env.local exists in the root.
rem - Copies .env.local.example to .env.local if it is missing.
if not exist ".env.local" (
    echo [INFO] Copying .env.local.example to .env.local...
    copy ".env.local.example" ".env.local"
)

rem 2. Check and copy backend environment configuration.
rem - Checks if backend\.env exists.
rem - Copies backend\.env.example to backend\.env if missing.
rem - Advises the user to add necessary keys.
if not exist "backend\.env" (
    echo [INFO] Copying backend\.env.example to backend\.env...
    copy "backend\.env.example" "backend\.env"
    echo [WARNING] Please open backend\.env and configure the required environment variables.
)

rem 3. Detect or create the Python virtual environment.
rem - Checks if 'write-me-it' virtual environment exists first (matching the project name).
rem - Checks if 'venv' virtual environment exists as a fallback.
rem - Creates 'write-me-it' virtual environment and installs requirements if neither exists.
set "VENV_NAME="
if exist "backend\write-me-it\Scripts\activate" (
    set "VENV_NAME=write-me-it"
) else if exist "backend\venv\Scripts\activate" (
    set "VENV_NAME=venv"
) else (
    echo [INFO] Creating Python virtual environment named 'write-me-it'...
    cd backend
    python -m venv write-me-it
    set "VENV_NAME=write-me-it"
    echo [INFO] Installing python dependencies in virtual environment...
    call write-me-it\Scripts\activate.bat
    pip install -r requirements.txt
    cd ..
)

rem 4. Ensure node dependencies are installed.
rem - Checks if node_modules directory exists.
rem - Installs packages using npm install if it is missing.
if not exist "node_modules" (
    echo [INFO] Installing node packages...
    call npm install
)

rem 5. Start the backend FastAPI server in a new window.
rem - Changes directory to backend.
rem - Activates the detected virtual environment.
rem - Runs the FastAPI application using uvicorn on port 8000.
echo Starting Backend...
start "Backend (FastAPI)" cmd /k "cd backend && call %VENV_NAME%\Scripts\activate.bat && uvicorn main:app --reload --port 8000"

rem 6. Start the Next.js frontend server in a new window.
rem - Starts the Next.js application in development mode using npm.
echo Starting Frontend...
start "Frontend (Next.js)" cmd /k "npm run dev"

echo Startup complete. Both servers are running in separate terminal windows.
pause
