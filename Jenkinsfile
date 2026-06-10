// AI Native Loop — Docker 构建示例
// Git 源：https://github.com/shangyehuazhinengjiance/loop
// 关键：docker build 的 context 必须是仓库根目录（最后一个参数为 .）

pipeline {
  agent any

  environment {
    REGISTRY = 'harbor.qihoo.net/your-namespace'
    // Dockerfile 使用 RUN --mount=type=cache，必须启用 BuildKit（Docker 18.09+）
    DOCKER_BUILDKIT = '1'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        // 校验 monorepo 结构完整
        sh 'test -f packages/shared/package.json'
        sh 'test -f packages/orchestrator/package.json'
      }
    }

    stage('Build Orchestrator') {
      steps {
        sh '''
          # 18.09 起支持 BuildKit，但必须显式开启；变量写在同一行最稳妥
          DOCKER_BUILDKIT=1 docker build -f Dockerfile -t ${REGISTRY}/loop-orchestrator:${BUILD_NUMBER} .
        '''
      }
    }

    stage('Push') {
      steps {
        sh 'docker push ${REGISTRY}/loop-orchestrator:${BUILD_NUMBER}'
      }
    }
  }
}
