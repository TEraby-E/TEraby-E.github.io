// 参考《算法题讲义》第 4 章（第 148-151、154、179 页）。
#include <iostream>
#include <queue>

struct BTNode {
    int data = 0;
    BTNode *lchild = nullptr;
    BTNode *rchild = nullptr;
};

// 按题意替换结点访问操作，例如输出或统计。
void visitNode(const BTNode *node) {
    std::cout << node->data << ' ';
}

// 先序：根、左、右。
void preOrder(const BTNode *node) {
    if (node == nullptr) return;
    visitNode(node);
    preOrder(node->lchild);
    preOrder(node->rchild);
}

// 中序：左、根、右。
void inOrder(const BTNode *node) {
    if (node == nullptr) return;
    inOrder(node->lchild);
    visitNode(node);
    inOrder(node->rchild);
}

// 后序：左、右、根。
void postOrder(const BTNode *node) {
    if (node == nullptr) return;
    postOrder(node->lchild);
    postOrder(node->rchild);
    visitNode(node);
}

void levelOrder(const BTNode *root) {
    if (root == nullptr) return;
    std::queue<const BTNode *> queue;
    queue.push(root);
    while (!queue.empty()) {
        const BTNode *node = queue.front();
        queue.pop();
        visitNode(node);
        if (node->lchild != nullptr) queue.push(node->lchild);
        if (node->rchild != nullptr) queue.push(node->rchild);
    }
}
